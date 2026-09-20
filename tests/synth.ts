import type { PcmAudio, SampleRange } from "../src/audio/audioTypes";

export type Segment =
  | { kind: "speech"; ms: number; db?: number; tailMs?: number; channel?: "both" | "right" }
  | { kind: "sound"; ms: number; db: number } // breath / click / steady noise — audible, must be protected
  | { kind: "click"; ms: number; db: number } // non-speech transient: allowed to be removed with its pause
  | { kind: "gap"; ms: number };

export interface SynthOptions {
  sampleRate?: number;
  floorDb?: number; // background noise floor, present everywhere
  seed?: number;
}

export interface Synth {
  audio: PcmAudio;
  /** Ground truth: every range containing audible (non-floor) sound, incl. decay tails. */
  audible: SampleRange[];
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AUDIBLE_DB = -60; // tails are considered audible until they fall below this

/** Unit-RMS noise sample. */
const noise = (r: () => number): number => (r() * 2 - 1) * Math.sqrt(3);

export function synth(segments: Segment[], opts: SynthOptions = {}): Synth {
  const sr = opts.sampleRate ?? 48000;
  const floorAmp = Math.pow(10, (opts.floorDb ?? -70) / 20);
  const r = rng(opts.seed ?? 1);
  const total = Math.round(segments.reduce((a, s) => a + s.ms, 0) * sr / 1000);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    left[i] = noise(r) * floorAmp;
    right[i] = noise(r) * floorAmp;
  }

  const audible: SampleRange[] = [];
  let cursor = 0;
  for (const seg of segments) {
    const start = cursor;
    const end = cursor + Math.round((seg.ms * sr) / 1000);
    cursor = end;
    if (seg.kind === "gap") continue;

    const amp = Math.pow(10, (seg.kind === "speech" ? seg.db ?? -14 : seg.db) / 20);
    const attack = Math.round(0.01 * sr);
    const tailMs = seg.kind === "speech" ? seg.tailMs ?? 10 : 5;
    // exponential tail: falls 60 dB over tailMs
    const tau = (tailMs / 1000) * sr / (3 * Math.LN10);
    const tailLen = Math.ceil(tau * Math.log(amp / Math.pow(10, AUDIBLE_DB / 20)));
    const onlyRight = seg.kind === "speech" && seg.channel === "right";

    for (let i = start; i < Math.min(total, end + Math.max(0, tailLen)); i++) {
      let env: number;
      if (i < end) {
        env = Math.min(1, (i - start) / attack);
        if (seg.kind === "speech") env *= 0.6 + 0.4 * Math.abs(Math.sin((2 * Math.PI * 4 * (i - start)) / sr));
      } else {
        env = Math.exp(-(i - end) / tau);
      }
      const v = noise(r) * amp * env;
      if (!onlyRight) left[i]! += v;
      right[i]! += v;
    }
    if (seg.kind !== "click") audible.push({ start, end: Math.min(total, end + Math.max(0, tailLen)) });
  }
  return { audio: { sampleRate: sr, channels: [left, right] }, audible };
}

export function ms(n: number, sr = 48000): number {
  return Math.round((n * sr) / 1000);
}

/** Minimal WAV encoder for round-trip tests. */
export function encodeWav(audio: PcmAudio, bits: 16 | 24 | 32, float = false): Uint8Array {
  const ch = audio.channels.length;
  const frames = audio.channels[0]!.length;
  const bps = bits / 8;
  const dataSize = frames * ch * bps;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w = (o: number, s: string): void => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + dataSize, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, audio.sampleRate, true); v.setUint32(28, audio.sampleRate * ch * bps, true);
  v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  w(36, "data"); v.setUint32(40, dataSize, true);
  let p = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, audio.channels[c]![f]!));
      if (float) v.setFloat32(p, x, true);
      else if (bits === 16) v.setInt16(p, Math.round(x * 32767), true);
      else if (bits === 24) { const iv = Math.round(x * 8388607); v.setUint8(p, iv & 255); v.setUint8(p + 1, (iv >> 8) & 255); v.setUint8(p + 2, (iv >> 16) & 255); }
      else v.setInt32(p, Math.round(x * 2147483647), true);
      p += bps;
    }
  }
  return new Uint8Array(buf);
}
