import { computeLevels } from "./audio/analyzer";
import {
  CutFlowXError,
  DEFAULT_TUNING,
  type DetectionSettings,
  type EngineTuning,
  type PcmAudio,
  type SampleRange,
} from "./audio/audioTypes";
import { refineRun } from "./audio/boundaryRefiner";
import { detectQuietRuns, mergeCloseRuns, runDetectedSpan, runSafeRange } from "./audio/silenceDetector";
import {
  frameToTicks,
  sampleToFrameCeil,
  sampleToFrameFloor,
  ticksPerFrame,
  type FrameRate,
} from "./premiere/timecode";

/** One region that will be removed, with every intermediate stage kept for diagnostics (§26). */
export interface CutRegion {
  readonly index: number;
  /** What a plain threshold detector would report (union of quiet windows). */
  readonly detected: SampleRange;
  /** Surely-quiet samples after boundary refinement. */
  readonly refined: SampleRange;
  /** After padding — the audio we intend to remove. */
  readonly padded: SampleRange;
  /** Removed frames [startFrame, endFrame), always strictly inside `padded`. */
  readonly startFrame: number;
  readonly endFrame: number;
  /** Tick positions relative to the start of the analyzed range. */
  readonly startTicks: bigint;
  readonly endTicks: bigint;
  readonly floorDb: number;
}

export type DropReason = "no-stable-floor" | "shorter-than-minimum" | "consumed-by-padding" | "shorter-than-one-frame";

export interface DroppedRegion {
  readonly detected: SampleRange;
  readonly reason: DropReason;
}

export interface AnalysisResult {
  readonly sampleRate: number;
  readonly channels: number;
  readonly totalSamples: number;
  readonly totalFrames: number;
  readonly frameRate: FrameRate;
  readonly ticksPerFrame: bigint;
  readonly settings: DetectionSettings;
  readonly tuning: EngineTuning;
  readonly rawRegionCount: number;
  readonly regions: readonly CutRegion[];
  readonly dropped: readonly DroppedRegion[];
  /** Seconds of detected silence belonging to the regions that will be cut. */
  readonly detectedSilenceSec: number;
  /** Exact seconds that will disappear from the timeline (whole frames). */
  readonly removableSec: number;
}

export function validateSettings(s: DetectionSettings): void {
  const check = (ok: boolean, message: string): void => {
    if (!ok) throw new CutFlowXError(message);
  };
  check(Number.isFinite(s.thresholdDb) && s.thresholdDb >= -90 && s.thresholdDb <= -6, "Threshold must be between -90 dB and -6 dB.");
  check(Number.isFinite(s.minSilenceMs) && s.minSilenceMs >= 50 && s.minSilenceMs <= 60_000, "Minimum silence must be between 50 ms and 60 s.");
  check(Number.isFinite(s.paddingBeforeMs) && s.paddingBeforeMs >= 0 && s.paddingBeforeMs <= 2000, "Padding before must be between 0 and 2000 ms.");
  check(Number.isFinite(s.paddingAfterMs) && s.paddingAfterMs >= 0 && s.paddingAfterMs <= 2000, "Padding after must be between 0 and 2000 ms.");
}

const msToSamples = (ms: number, sampleRate: number): number => Math.round((ms * sampleRate) / 1000);

/**
 * Pure detection: audio in, validated frame-accurate cut regions out.
 * Does not know Premiere exists (§37).
 */
export function analyzeSilence(
  audio: PcmAudio,
  settings: DetectionSettings,
  frameRate: FrameRate,
  tuning: EngineTuning = DEFAULT_TUNING,
): AnalysisResult {
  validateSettings(settings);
  if (tuning.windowMs % tuning.hopMs !== 0) throw new CutFlowXError("Internal tuning error.", "windowMs must be a multiple of hopMs");
  const tpf = ticksPerFrame(frameRate);

  const levels = computeLevels(audio, tuning);
  const sr = levels.sampleRate;
  const n = levels.totalSamples;
  const totalFrames = sampleToFrameFloor(n, sr, frameRate);

  const rawRuns = detectQuietRuns(levels, settings.thresholdDb, tuning);
  const runs = mergeCloseRuns(rawRuns, tuning);

  const minSamples = msToSamples(settings.minSilenceMs, sr);
  const padBefore = msToSamples(settings.paddingBeforeMs, sr);
  const padAfter = msToSamples(settings.paddingAfterMs, sr);

  const regions: CutRegion[] = [];
  const dropped: DroppedRegion[] = [];

  for (const run of runs) {
    const detected = runDetectedSpan(run, levels);
    if (detected.end - detected.start < minSamples) {
      dropped.push({ detected, reason: "shorter-than-minimum" });
      continue;
    }

    const refinedOutcome = refineRun(run, levels, settings.thresholdDb, tuning);
    if (!refinedOutcome.ok) {
      dropped.push({ detected, reason: refinedOutcome.reason });
      continue;
    }
    const refinedSpan = runDetectedSpan(refinedOutcome.run, levels);
    if (refinedSpan.end - refinedSpan.start < minSamples) {
      dropped.push({ detected, reason: "shorter-than-minimum" });
      continue;
    }
    const refined = runSafeRange(refinedOutcome.run, levels);

    const padded: SampleRange = { start: refined.start + padBefore, end: refined.end - padAfter };
    if (padded.end <= padded.start) {
      dropped.push({ detected, reason: "consumed-by-padding" });
      continue;
    }

    // Snap INWARD: start rounds up, end rounds down. The removed frames can
    // only ever be a subset of the padded range, never wider.
    const startFrame = sampleToFrameCeil(padded.start, sr, frameRate);
    const endFrame = Math.min(totalFrames, sampleToFrameFloor(padded.end, sr, frameRate));
    if (endFrame <= startFrame) {
      dropped.push({ detected, reason: "shorter-than-one-frame" });
      continue;
    }

    regions.push({
      index: regions.length,
      detected,
      refined,
      padded,
      startFrame,
      endFrame,
      startTicks: frameToTicks(startFrame, frameRate),
      endTicks: frameToTicks(endFrame, frameRate),
      floorDb: refinedOutcome.floorDb,
    });
  }

  const detectedSilenceSec = regions.reduce((acc, r) => acc + (r.detected.end - r.detected.start), 0) / sr;
  const removedFrames = regions.reduce((acc, r) => acc + (r.endFrame - r.startFrame), 0);

  return {
    sampleRate: sr,
    channels: audio.channels.length,
    totalSamples: n,
    totalFrames,
    frameRate,
    ticksPerFrame: tpf,
    settings,
    tuning,
    rawRegionCount: rawRuns.length,
    regions,
    dropped,
    detectedSilenceSec,
    removableSec: (removedFrames * frameRate.den) / frameRate.num,
  };
}
