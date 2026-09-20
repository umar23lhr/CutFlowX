import { CutFlowXError, type EngineTuning, type LevelTrack, type PcmAudio } from "./audioTypes";

export const DB_FLOOR = -120;

export function validateAudio(audio: PcmAudio): number {
  if (!Number.isSafeInteger(audio.sampleRate) || audio.sampleRate <= 0) {
    throw new CutFlowXError("The audio has an invalid sample rate.", `sampleRate=${audio.sampleRate}`);
  }
  const first = audio.channels[0];
  if (!first) throw new CutFlowXError("No audio found to analyze.", "channels=0");
  for (const ch of audio.channels) {
    if (ch.length !== first.length) {
      throw new CutFlowXError("The audio channels have different lengths.", "invalid extraction");
    }
  }
  if (first.length === 0) throw new CutFlowXError("The audio is empty.", "samples=0");
  return first.length;
}

/**
 * Measures the level of the audio in short overlapping windows.
 * Per window, the RMS of each channel is computed and the LOUDEST channel wins,
 * so speech that exists on only one channel is never mistaken for silence.
 */
export function computeLevels(audio: PcmAudio, tuning: EngineTuning): LevelTrack {
  const total = validateAudio(audio);
  const hop = Math.max(1, Math.round((audio.sampleRate * tuning.hopMs) / 1000));
  const blocksPerWindow = Math.max(1, Math.round(tuning.windowMs / tuning.hopMs));
  const windowSamples = hop * blocksPerWindow;
  const blockCount = Math.ceil(total / hop);

  // Sum of squares per hop-sized block, per channel. Windows are sums of blocks.
  const blockSums = audio.channels.map((ch) => {
    const sums = new Float64Array(blockCount);
    for (let b = 0; b < blockCount; b++) {
      const end = Math.min(total, (b + 1) * hop);
      let acc = 0;
      for (let i = b * hop; i < end; i++) {
        const v = ch[i]!;
        acc += v * v;
      }
      sums[b] = acc;
    }
    return sums;
  });

  const db = new Float32Array(blockCount);
  for (let k = 0; k < blockCount; k++) {
    const lastBlock = Math.min(blockCount, k + blocksPerWindow);
    const len = Math.min(total, k * hop + windowSamples) - k * hop;
    let loudestMeanSquare = 0;
    for (const sums of blockSums) {
      let acc = 0;
      for (let b = k; b < lastBlock; b++) acc += sums[b]!;
      loudestMeanSquare = Math.max(loudestMeanSquare, acc / len);
    }
    db[k] = loudestMeanSquare > 0 ? Math.max(DB_FLOOR, 10 * Math.log10(loudestMeanSquare)) : DB_FLOOR;
  }

  return { sampleRate: audio.sampleRate, hopSamples: hop, windowSamples, totalSamples: total, db };
}
