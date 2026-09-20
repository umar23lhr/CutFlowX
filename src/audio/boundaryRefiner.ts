import type { EngineTuning, LevelTrack, WindowRun } from "./audioTypes";

export type RefineOutcome =
  | { readonly ok: true; readonly run: WindowRun; readonly floorDb: number; readonly settleDb: number }
  | { readonly ok: false; readonly reason: "no-stable-floor"; readonly floorDb: number };

/**
 * Crossing the threshold is not the end of a word: consonant releases, "s"
 * tails and room reverb keep decaying below the threshold while still audible,
 * and a word onset starts rising before it crosses the threshold.
 *
 * So each boundary is moved INTO the silence until the level has settled
 * near the region's own noise floor (floor + settleDb, never above the
 * threshold) and stays there for settleMs. Boundaries only ever move away from
 * speech. If the region never settles, it is rejected — a missed silence is
 * preferable to a damaged word.
 */
export function refineRun(
  run: WindowRun,
  levels: LevelTrack,
  thresholdDb: number,
  tuning: EngineTuning,
): RefineOutcome {
  const db = levels.db;
  const values = Array.from(db.subarray(run.first, run.last + 1)).sort((a, b) => a - b);
  const floorDb = values[Math.floor((values.length - 1) * tuning.floorPercentile)]!;
  const settleDb = Math.min(floorDb + tuning.settleDb, thresholdDb);
  const settleWindows = Math.max(1, Math.round(tuning.settleMs / tuning.hopMs));

  let first = -1;
  let streak = 0;
  for (let k = run.first; k <= run.last; k++) {
    streak = db[k]! <= settleDb ? streak + 1 : 0;
    if (streak >= settleWindows) {
      first = k - settleWindows + 1;
      break;
    }
  }
  if (first < 0) return { ok: false, reason: "no-stable-floor", floorDb };

  let last = -1;
  streak = 0;
  for (let k = run.last; k >= first; k--) {
    streak = db[k]! <= settleDb ? streak + 1 : 0;
    if (streak >= settleWindows) {
      last = k + settleWindows - 1;
      break;
    }
  }
  // Unreachable while `first` exists (the forward streak is found backward too), kept as a guard.
  if (last < 0) return { ok: false, reason: "no-stable-floor", floorDb };

  return { ok: true, run: { first, last }, floorDb, settleDb };
}
