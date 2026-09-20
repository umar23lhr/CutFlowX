import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type DetectionSettings, type SampleRange } from "../src/audio/audioTypes";
import { keepRanges, validateCutPlan } from "../src/cutting/cutValidation";
import { formatDiagnostics } from "../src/cutting/diagnostics";
import { analyzeSilence, type AnalysisResult } from "../src/engine";
import { FRAME_RATES, type FrameRate } from "../src/premiere/timecode";
import { ms, synth, type Segment } from "./synth";

const FPS25 = FRAME_RATES.fps25;

/** Exact sample position (as a number) where a frame begins. */
const frameToSample = (frame: number, sr: number, fr: FrameRate): number => (frame * sr * fr.den) / fr.num;

/**
 * THE core invariant: no removed frame may touch audible sound, and every cut
 * must keep at least the configured padding on both sides of it.
 */
function expectNoSpeechRemoved(result: AnalysisResult, audible: SampleRange[], s: DetectionSettings = DEFAULT_SETTINGS): void {
  const sr = result.sampleRate;
  const padBefore = ms(s.paddingBeforeMs, sr);
  const padAfter = ms(s.paddingAfterMs, sr);
  for (const r of result.regions) {
    const cutStart = frameToSample(r.startFrame, sr, result.frameRate);
    const cutEnd = frameToSample(r.endFrame, sr, result.frameRate);
    expect(cutStart).toBeGreaterThanOrEqual(0);
    expect(cutEnd).toBeLessThanOrEqual(result.totalSamples);
    for (const a of audible) {
      const protectedStart = a.start - padAfter; // padding kept before speech resumes
      const protectedEnd = a.end + padBefore; // padding kept after speech ends
      const overlaps = cutStart < protectedEnd && cutEnd > protectedStart;
      if (overlaps) {
        throw new Error(
          `Region #${r.index + 1} removes samples ${cutStart}–${cutEnd}, which touches protected audio ${protectedStart}–${protectedEnd}\n` +
            formatDiagnostics(result, "synthetic"),
        );
      }
    }
  }
  validateCutPlan(result);
}

function run(segments: Segment[], fr: FrameRate = FPS25, settings: DetectionSettings = DEFAULT_SETTINGS, floorDb = -70) {
  const { audio, audible } = synth(segments, { floorDb });
  const result = analyzeSilence(audio, settings, fr);
  expectNoSpeechRemoved(result, audible, settings);
  return { result, audible };
}

const removedSec = (r: AnalysisResult): number => r.removableSec;

describe("silence engine", () => {
  it("1. speech → long silence → speech: silence is removed", () => {
    const { result } = run([{ kind: "speech", ms: 1000 }, { kind: "gap", ms: 1500 }, { kind: "speech", ms: 1000 }]);
    expect(result.regions).toHaveLength(1);
    // 1.5 s gap minus padding (0.18 s) minus refinement/frame snapping: most of it goes.
    expect(removedSec(result)).toBeGreaterThan(1.1);
    expect(removedSec(result)).toBeLessThan(1.32);
  });

  it("2. speech → 100 ms pause → speech: pause is preserved", () => {
    const { result } = run([{ kind: "speech", ms: 1000 }, { kind: "gap", ms: 100 }, { kind: "speech", ms: 1000 }]);
    expect(result.regions).toHaveLength(0);
  });

  it("2b. a pause just under the minimum is preserved", () => {
    const { result } = run([{ kind: "speech", ms: 800 }, { kind: "gap", ms: 450 }, { kind: "speech", ms: 800 }]);
    expect(result.regions).toHaveLength(0);
  });

  it("3. quiet speech above the threshold is preserved", () => {
    const { result } = run([
      { kind: "speech", ms: 1000 },
      { kind: "speech", ms: 1500, db: -27 },
      { kind: "gap", ms: 1000 },
      { kind: "speech", ms: 1500, db: -27 },
    ]);
    expect(result.regions).toHaveLength(1); // only the real gap
  });

  it("4. continuous background noise above the threshold is not treated as silence", () => {
    const { result } = run([{ kind: "sound", ms: 5000, db: -26 }]);
    expect(result.regions).toHaveLength(0);
  });

  it("4b. speech over a noise bed below the threshold: gaps still detected, speech kept", () => {
    const { result } = run(
      [{ kind: "speech", ms: 1000 }, { kind: "gap", ms: 1200 }, { kind: "speech", ms: 1000 }],
      FPS25,
      DEFAULT_SETTINGS,
      -45,
    );
    expect(result.regions).toHaveLength(1);
  });

  it("5. an audible breath splitting a pause keeps both short halves", () => {
    const { result } = run([
      { kind: "speech", ms: 1000 },
      { kind: "gap", ms: 350 },
      { kind: "sound", ms: 250, db: -28 },
      { kind: "gap", ms: 350 },
      { kind: "speech", ms: 1000 },
    ]);
    expect(result.regions).toHaveLength(0);
  });

  it("6. very long silence is detected and removed", () => {
    const { result } = run([{ kind: "speech", ms: 1000 }, { kind: "gap", ms: 30_000 }, { kind: "speech", ms: 1000 }]);
    expect(result.regions).toHaveLength(1);
    expect(removedSec(result)).toBeGreaterThan(29.5);
  });

  it("7. silence at the timeline start: no negative positions", () => {
    const { result } = run([{ kind: "gap", ms: 2000 }, { kind: "speech", ms: 1000 }]);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]!.startFrame).toBeGreaterThanOrEqual(0);
    expect(result.regions[0]!.startTicks).toBeGreaterThanOrEqual(0n);
  });

  it("8. silence at the timeline end: no out-of-range cut", () => {
    const { result } = run([{ kind: "speech", ms: 1000 }, { kind: "gap", ms: 2000 }]);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]!.endFrame).toBeLessThanOrEqual(result.totalFrames);
  });

  for (const [label, fr] of [
    ["9. 23.976", FRAME_RATES.fps23_976],
    ["10. 29.97", FRAME_RATES.fps29_97],
    ["11. 59.94", FRAME_RATES.fps59_94],
  ] as const) {
    it(`${label} fps: cuts are whole frames strictly inside the padded region`, () => {
      const { result } = run(
        [{ kind: "speech", ms: 700 }, { kind: "gap", ms: 1333 }, { kind: "speech", ms: 900 }, { kind: "gap", ms: 777 }, { kind: "speech", ms: 500 }],
        fr,
      );
      expect(result.regions).toHaveLength(2);
      for (const r of result.regions) {
        expect(frameToSample(r.startFrame, result.sampleRate, fr)).toBeGreaterThanOrEqual(r.padded.start);
        expect(frameToSample(r.endFrame, result.sampleRate, fr)).toBeLessThanOrEqual(r.padded.end);
        // snapping inward loses less than one frame on each side
        const frameSamples = (result.sampleRate * fr.den) / fr.num;
        expect(frameToSample(r.startFrame, result.sampleRate, fr) - r.padded.start).toBeLessThan(frameSamples);
        expect(r.padded.end - frameToSample(r.endFrame, result.sampleRate, fr)).toBeLessThan(frameSamples);
        expect(r.startTicks).toBe(BigInt(r.startFrame) * result.ticksPerFrame);
      }
    });
  }

  it("12. multiple consecutive regions are filtered correctly", () => {
    const { result } = run([
      { kind: "speech", ms: 600 },
      { kind: "gap", ms: 1000 }, // cut
      { kind: "speech", ms: 400 },
      { kind: "gap", ms: 300 }, // keep (too short)
      { kind: "speech", ms: 400 },
      { kind: "gap", ms: 2000 }, // cut
      { kind: "speech", ms: 300 },
      { kind: "gap", ms: 800 }, // cut
      { kind: "speech", ms: 600 },
    ]);
    expect(result.regions).toHaveLength(3);
    const keeps = keepRanges(result);
    expect(keeps).toHaveLength(4);
  });

  it("12b. a short click inside a pause merges the pause into one region", () => {
    const { result } = run([
      { kind: "speech", ms: 800 },
      { kind: "gap", ms: 600 },
      { kind: "click", ms: 8, db: -6 },
      { kind: "gap", ms: 600 },
      { kind: "speech", ms: 800 },
    ]);
    expect(result.rawRegionCount).toBe(2); // the click really did split the pause...
    expect(result.regions).toHaveLength(1); // ...and the merge rejoined it
  });

  it("refinement: a long decaying word tail is not cut", () => {
    const { result, audible } = run([{ kind: "speech", ms: 800, tailMs: 250 }, { kind: "gap", ms: 1500 }, { kind: "speech", ms: 800 }]);
    expect(result.regions).toHaveLength(1);
    const r = result.regions[0]!;
    // The tail stays above -60 dBFS well after the threshold crossing; the cut starts after it plus padding.
    expect(r.padded.start).toBeGreaterThanOrEqual(audible[0]!.end + ms(DEFAULT_SETTINGS.paddingBeforeMs));
    expect(r.refined.start).toBeGreaterThan(r.detected.start);
  });

  it("speech on only one channel is not mistaken for silence", () => {
    const { result } = run([
      { kind: "speech", ms: 800 },
      { kind: "gap", ms: 400 },
      { kind: "speech", ms: 1500, channel: "right" },
      { kind: "gap", ms: 400 },
      { kind: "speech", ms: 800 },
    ]);
    expect(result.regions).toHaveLength(0);
  });

  it("larger padding never removes more audio", () => {
    const segs: Segment[] = [{ kind: "speech", ms: 800 }, { kind: "gap", ms: 1200 }, { kind: "speech", ms: 800 }];
    const a = run(segs).result;
    const b = run(segs, FPS25, { ...DEFAULT_SETTINGS, paddingBeforeMs: 200, paddingAfterMs: 200 }).result;
    expect(b.removableSec).toBeLessThan(a.removableSec);
  });

  it("rejects invalid settings with a readable message", () => {
    const { audio } = synth([{ kind: "gap", ms: 100 }]);
    expect(() => analyzeSilence(audio, { ...DEFAULT_SETTINGS, thresholdDb: 5 }, FPS25)).toThrow(/Threshold must be/);
  });

  it("is deterministic for identical input", () => {
    const segs: Segment[] = [{ kind: "speech", ms: 500 }, { kind: "gap", ms: 900 }, { kind: "speech", ms: 500 }];
    expect(run(segs).result.regions).toEqual(run(segs).result.regions);
  });
});
