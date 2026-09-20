/** Decoded PCM audio. Sample 0 must correspond to the start of the analyzed timeline range. */
export interface PcmAudio {
  readonly sampleRate: number;
  /** One Float32Array per channel, values nominally in [-1, 1], all equal length. */
  readonly channels: readonly Float32Array[];
}

/** Half-open range of sample indices [start, end). */
export interface SampleRange {
  readonly start: number;
  readonly end: number;
}

/** The four user-facing detection settings (§31). */
export interface DetectionSettings {
  /** Audio at or below this level (dBFS, windowed RMS) counts as quiet. */
  readonly thresholdDb: number;
  /** Only quiet regions at least this long are removed. */
  readonly minSilenceMs: number;
  /** Audio kept BEFORE each removed region — protects the end of the previous word. */
  readonly paddingBeforeMs: number;
  /** Audio kept AFTER each removed region — protects the start of the next word. */
  readonly paddingAfterMs: number;
}

export const DEFAULT_SETTINGS: DetectionSettings = {
  thresholdDb: -32,
  minSilenceMs: 500,
  paddingBeforeMs: 80,
  paddingAfterMs: 100,
};

/**
 * Internal engine constants. Not exposed in the UI; named here so there are no
 * magic numbers in the algorithm. Tune these with real-speech evidence only.
 */
export interface EngineTuning {
  /** RMS analysis window length. Must be a multiple of hopMs. */
  readonly windowMs: number;
  /** Step between analysis windows (time resolution of detection). */
  readonly hopMs: number;
  /** Inside a silence, the level may rise this far above the threshold without ending it. */
  readonly hysteresisDb: number;
  /** Two silences separated by a sound burst shorter than this are merged (clicks, pops). */
  readonly mergeGapMs: number;
  /** A boundary is "settled" when the level is within this many dB of the region's noise floor. */
  readonly settleDb: number;
  /** ...and stays there for at least this long. */
  readonly settleMs: number;
  /** Percentile (0–1) of window levels used as the region's noise floor. */
  readonly floorPercentile: number;
}

export const DEFAULT_TUNING: EngineTuning = {
  windowMs: 20,
  hopMs: 5,
  hysteresisDb: 3,
  mergeGapMs: 50,
  settleDb: 6,
  settleMs: 30,
  floorPercentile: 0.2,
};

/** Windowed level measurement. Window k covers samples [k*hop, min(k*hop + window, total)). */
export interface LevelTrack {
  readonly sampleRate: number;
  readonly hopSamples: number;
  readonly windowSamples: number;
  readonly totalSamples: number;
  /** Level in dBFS per window: the loudest channel's RMS. */
  readonly db: Float32Array;
}

/** Inclusive range of analysis-window indices. */
export interface WindowRun {
  readonly first: number;
  readonly last: number;
}

export class CutFlowXError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "CutFlowXError";
  }
}
