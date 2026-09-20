import type { EngineTuning, LevelTrack, SampleRange, WindowRun } from "./audioTypes";

/**
 * Finds runs of quiet analysis windows using hysteresis:
 *  - a silence STARTS at a window at or below `thresholdDb`;
 *  - it only ENDS when a window rises above `thresholdDb + hysteresisDb`,
 *    so level flicker around the threshold does not split one pause into many.
 * The edges of each run are always windows at or below the plain threshold:
 * hysteresis bridges the inside of a pause, it never widens it toward speech.
 */
export function detectQuietRuns(levels: LevelTrack, thresholdDb: number, tuning: EngineTuning): WindowRun[] {
  const exitDb = thresholdDb + tuning.hysteresisDb;
  const runs: WindowRun[] = [];
  let start = -1;
  let lastQuiet = -1;
  for (let k = 0; k < levels.db.length; k++) {
    const v = levels.db[k]!;
    if (start < 0) {
      if (v <= thresholdDb) {
        start = k;
        lastQuiet = k;
      }
    } else if (v > exitDb) {
      runs.push({ first: start, last: lastQuiet });
      start = -1;
    } else if (v <= thresholdDb) {
      lastQuiet = k;
    }
  }
  if (start >= 0) runs.push({ first: start, last: lastQuiet });
  return runs;
}

/**
 * Merges runs separated by a sound burst shorter than `mergeGapMs`
 * (a click, a pop). Real syllables are far longer than this gap, so a word
 * can never be swallowed by a merge.
 */
export function mergeCloseRuns(runs: readonly WindowRun[], tuning: EngineTuning): WindowRun[] {
  const maxGapWindows = Math.floor(tuning.mergeGapMs / tuning.hopMs);
  const merged: WindowRun[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run.first - prev.last - 1 <= maxGapWindows) {
      merged[merged.length - 1] = { first: prev.first, last: run.last };
    } else {
      merged.push(run);
    }
  }
  return merged;
}

/**
 * The span a naive detector would report: the union of the quiet windows.
 * Used for display and for the minimum-duration rule, never for cutting.
 */
export function runDetectedSpan(run: WindowRun, levels: LevelTrack): SampleRange {
  const start = run.first * levels.hopSamples;
  const end = Math.min(levels.totalSamples, run.last * levels.hopSamples + levels.windowSamples);
  return { start, end };
}

/**
 * The CONSERVATIVE sample range of a run: only samples whose every covering
 * window belongs to the run. A sample next to speech shares a window with the
 * speech, so it is excluded. This is what makes cuts land outside words.
 *
 * Window k covers [k*h, k*h + W). Sample t is covered only by run windows iff
 *   t >= (first - 1) * h + W   and   t < (last + 1) * h
 * (with the file edges treated as quiet boundaries).
 */
export function runSafeRange(run: WindowRun, levels: LevelTrack): SampleRange {
  const h = levels.hopSamples;
  const n = levels.totalSamples;
  const lastIndex = levels.db.length - 1;
  const start = run.first === 0 ? 0 : Math.min(n, (run.first - 1) * h + levels.windowSamples);
  const end = run.last === lastIndex ? n : Math.min(n, (run.last + 1) * h);
  return { start, end: Math.max(start, end) };
}
