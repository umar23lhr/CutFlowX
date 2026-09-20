/**
 * CutFlowX time utility — the ONLY place where audio time is converted to
 * timeline time. Everything is exact integer arithmetic (BigInt): no floating
 * point seconds ever reach the timeline, so there is nothing to round badly.
 *
 * Premiere expresses time in ticks: 254,016,000,000 per second. Every frame
 * rate Premiere supports (including 23.976, 29.97 and 59.94) has an integer
 * number of ticks per frame.
 */

export const TICKS_PER_SECOND = 254_016_000_000n;

/** Frame rate as an exact rational: fps = num / den (29.97 = 30000/1001). */
export interface FrameRate {
  readonly num: number;
  readonly den: number;
}

export const FRAME_RATES = {
  fps23_976: { num: 24000, den: 1001 },
  fps24: { num: 24, den: 1 },
  fps25: { num: 25, den: 1 },
  fps29_97: { num: 30000, den: 1001 },
  fps30: { num: 30, den: 1 },
  fps50: { num: 50, den: 1 },
  fps59_94: { num: 60000, den: 1001 },
  fps60: { num: 60, den: 1 },
} as const satisfies Record<string, FrameRate>;

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

function assertValidRate(rate: FrameRate): void {
  if (!Number.isInteger(rate.num) || !Number.isInteger(rate.den) || rate.num <= 0 || rate.den <= 0) {
    throw new RangeError(`Invalid frame rate ${rate.num}/${rate.den}`);
  }
}

/** Exact ticks per frame. Throws if the rate does not divide ticks evenly. */
export function ticksPerFrame(rate: FrameRate): bigint {
  assertValidRate(rate);
  const numerator = TICKS_PER_SECOND * BigInt(rate.den);
  const num = BigInt(rate.num);
  if (numerator % num !== 0n) {
    throw new RangeError(`Frame rate ${rate.num}/${rate.den} has no integer tick duration`);
  }
  return numerator / num;
}

/**
 * Premiere reports a sequence timebase as ticks-per-frame. Convert it back to
 * an exact, reduced rational frame rate.
 */
export function frameRateFromTicksPerFrame(tpf: bigint | string | number): FrameRate {
  const t = BigInt(tpf);
  if (t <= 0n) throw new RangeError(`Invalid timebase ${String(tpf)} ticks/frame`);
  const g = gcd(TICKS_PER_SECOND, t);
  const num = TICKS_PER_SECOND / g;
  const den = t / g;
  if (num > BigInt(Number.MAX_SAFE_INTEGER) || den > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Timebase ${String(tpf)} is not a representable frame rate`);
  }
  return { num: Number(num), den: Number(den) };
}

function assertSampleArgs(sample: number, sampleRate: number): void {
  if (!Number.isSafeInteger(sample) || sample < 0) throw new RangeError(`Invalid sample index ${sample}`);
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError(`Invalid sample rate ${sampleRate}`);
}

/**
 * Index of the frame that CONTAINS the given sample position (rounds down).
 * frame = floor(sample * num / (sampleRate * den))
 */
export function sampleToFrameFloor(sample: number, sampleRate: number, rate: FrameRate): number {
  assertSampleArgs(sample, sampleRate);
  assertValidRate(rate);
  const q = (BigInt(sample) * BigInt(rate.num)) / (BigInt(sampleRate) * BigInt(rate.den));
  return Number(q);
}

/** First frame boundary at or after the given sample position (rounds up). */
export function sampleToFrameCeil(sample: number, sampleRate: number, rate: FrameRate): number {
  assertSampleArgs(sample, sampleRate);
  assertValidRate(rate);
  const n = BigInt(sample) * BigInt(rate.num);
  const d = BigInt(sampleRate) * BigInt(rate.den);
  return Number((n + d - 1n) / d);
}

export function frameToTicks(frame: number, rate: FrameRate): bigint {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError(`Invalid frame ${frame}`);
  return BigInt(frame) * ticksPerFrame(rate);
}

/** Converts ticks to a frame index; throws if the ticks are not frame-aligned. */
export function ticksToFrameExact(ticks: bigint, rate: FrameRate): number {
  const tpf = ticksPerFrame(rate);
  if (ticks < 0n || ticks % tpf !== 0n) {
    throw new RangeError(`Tick value ${ticks} is not on a frame boundary at ${rate.num}/${rate.den}`);
  }
  return Number(ticks / tpf);
}

/** Exact sample position where a frame starts, as a rational (for checks and display). */
export function frameStartInSamples(frame: number, sampleRate: number, rate: FrameRate): { num: bigint; den: bigint } {
  return {
    num: BigInt(frame) * BigInt(sampleRate) * BigInt(rate.den),
    den: BigInt(rate.num),
  };
}

/** Human-readable clock HH:MM:SS.mmm for a sample position (display only). */
export function formatClock(sample: number, sampleRate: number): string {
  const totalMs = Math.floor((sample * 1000) / sampleRate);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (v: number, w = 2): string => String(v).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}
