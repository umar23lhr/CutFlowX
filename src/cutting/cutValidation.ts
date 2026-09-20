import { CutFlowXError } from "../audio/audioTypes";
import type { AnalysisResult } from "../engine";

export interface FrameRange {
  readonly startFrame: number;
  readonly endFrame: number;
}

/**
 * Validates the complete cut plan BEFORE Premiere is touched (§16):
 * sorted, non-overlapping, non-empty, inside the analyzed range.
 * Throws on the first problem; never returns a partially valid plan.
 */
export function validateCutPlan(result: AnalysisResult): readonly FrameRange[] {
  let previousEnd = 0;
  for (const r of result.regions) {
    const where = `region #${r.index + 1} (frames ${r.startFrame}–${r.endFrame})`;
    if (!Number.isSafeInteger(r.startFrame) || !Number.isSafeInteger(r.endFrame)) {
      throw new CutFlowXError("The cut plan is invalid.", `${where}: non-integer frame`);
    }
    if (r.startFrame < 0 || r.endFrame > result.totalFrames) {
      throw new CutFlowXError("The cut plan is invalid.", `${where}: outside 0–${result.totalFrames}`);
    }
    if (r.endFrame <= r.startFrame) {
      throw new CutFlowXError("The cut plan is invalid.", `${where}: empty region`);
    }
    if (r.startFrame < previousEnd) {
      throw new CutFlowXError("The cut plan is invalid.", `${where}: overlaps or is out of order`);
    }
    previousEnd = r.endFrame;
  }
  return result.regions.map(({ startFrame, endFrame }) => ({ startFrame, endFrame }));
}

/** The complement of the cut regions: what stays on the timeline, in order. */
export function keepRanges(result: AnalysisResult): readonly FrameRange[] {
  const cuts = validateCutPlan(result);
  const keeps: FrameRange[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.startFrame > cursor) keeps.push({ startFrame: cursor, endFrame: c.startFrame });
    cursor = c.endFrame;
  }
  if (cursor < result.totalFrames) keeps.push({ startFrame: cursor, endFrame: result.totalFrames });
  return keeps;
}
