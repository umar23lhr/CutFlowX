import { describe, expect, it } from "vitest";
import { parseWav } from "../src/audio/wavReader";
import {
  FRAME_RATES,
  TICKS_PER_SECOND,
  frameRateFromTicksPerFrame,
  frameToTicks,
  sampleToFrameCeil,
  sampleToFrameFloor,
  ticksPerFrame,
  ticksToFrameExact,
} from "../src/premiere/timecode";
import { encodeWav, synth } from "./synth";

describe("timecode", () => {
  it("every supported rate has an exact integer tick duration", () => {
    expect(ticksPerFrame(FRAME_RATES.fps23_976)).toBe(10_594_584_000n);
    expect(ticksPerFrame(FRAME_RATES.fps24)).toBe(10_584_000_000n);
    expect(ticksPerFrame(FRAME_RATES.fps25)).toBe(10_160_640_000n);
    expect(ticksPerFrame(FRAME_RATES.fps29_97)).toBe(8_475_667_200n);
    expect(ticksPerFrame(FRAME_RATES.fps30)).toBe(8_467_200_000n);
    expect(ticksPerFrame(FRAME_RATES.fps50)).toBe(5_080_320_000n);
    expect(ticksPerFrame(FRAME_RATES.fps59_94)).toBe(4_237_833_600n);
    expect(ticksPerFrame(FRAME_RATES.fps60)).toBe(4_233_600_000n);
  });

  it("recovers the exact rational rate from a Premiere timebase", () => {
    for (const fr of Object.values(FRAME_RATES)) {
      expect(frameRateFromTicksPerFrame(ticksPerFrame(fr))).toEqual(fr);
      expect(frameRateFromTicksPerFrame(ticksPerFrame(fr).toString())).toEqual(fr);
    }
  });

  it("29.97: frame 1 starts at sample 1601.6 of 48 kHz audio", () => {
    const fr = FRAME_RATES.fps29_97;
    expect(sampleToFrameFloor(1601, 48000, fr)).toBe(0);
    expect(sampleToFrameFloor(1602, 48000, fr)).toBe(1);
    expect(sampleToFrameCeil(1601, 48000, fr)).toBe(1);
    expect(sampleToFrameCeil(1602, 48000, fr)).toBe(2);
    expect(sampleToFrameCeil(0, 48000, fr)).toBe(0);
  });

  it("exact frame boundaries do not round in either direction", () => {
    const fr = FRAME_RATES.fps23_976; // frame 5 at 48 kHz = 5 * 2002 = 10010 samples
    expect(sampleToFrameFloor(10010, 48000, fr)).toBe(5);
    expect(sampleToFrameCeil(10010, 48000, fr)).toBe(5);
  });

  it("stays exact beyond 10 hours (past double-precision tick range)", () => {
    const fr = FRAME_RATES.fps23_976;
    const frame = 24 * 3600 * 11;
    const ticks = frameToTicks(frame, fr);
    expect(ticks > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(ticksToFrameExact(ticks, fr)).toBe(frame);
  });

  it("refuses non-frame-aligned ticks", () => {
    expect(() => ticksToFrameExact(TICKS_PER_SECOND / 1000n, FRAME_RATES.fps25)).toThrow();
  });
});

describe("wav reader", () => {
  const { audio } = synth([{ kind: "speech", ms: 50 }], { seed: 7 });

  for (const [bits, float, tol] of [[16, false, 1 / 32767], [24, false, 1 / 8388607], [32, true, 1e-7]] as const) {
    it(`round-trips ${bits}-bit ${float ? "float" : "PCM"}`, () => {
      const parsed = parseWav(encodeWav(audio, bits, float));
      expect(parsed.sampleRate).toBe(48000);
      expect(parsed.channels).toHaveLength(2);
      expect(parsed.channels[0]!.length).toBe(audio.channels[0]!.length);
      for (let i = 0; i < 500; i++) {
        expect(Math.abs(parsed.channels[1]![i]! - audio.channels[1]![i]!)).toBeLessThanOrEqual(tol * 1.01);
      }
    });
  }

  it("rejects non-WAV data with a readable error", () => {
    expect(() => parseWav(new Uint8Array(64))).toThrow(/could not be read/);
  });
});
