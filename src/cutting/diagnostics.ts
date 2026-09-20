import type { SampleRange } from "../audio/audioTypes";
import type { AnalysisResult } from "../engine";
import { formatClock } from "../premiere/timecode";

/** Plain-text diagnostics (§26). Every stage of every cut is visible, so a wrong cut can be traced to its layer. */
export function formatDiagnostics(result: AnalysisResult, audioSource = "(unspecified)"): string {
  const sr = result.sampleRate;
  const range = (r: SampleRange): string => `${formatClock(r.start, sr)} → ${formatClock(r.end, sr)}`;
  const fps = result.frameRate.num / result.frameRate.den;
  const s = result.settings;
  const lines: string[] = [
    `Audio source:      ${audioSource}`,
    `Duration:          ${formatClock(result.totalSamples, sr)} (${result.totalSamples} samples)`,
    `Sample rate:       ${sr} Hz`,
    `Channels:          ${result.channels}`,
    `Threshold:         ${s.thresholdDb} dB`,
    `Minimum silence:   ${s.minSilenceMs} ms`,
    `Padding before:    ${s.paddingBeforeMs} ms`,
    `Padding after:     ${s.paddingAfterMs} ms`,
    `Sequence FPS:      ${fps.toFixed(3)} (${result.frameRate.num}/${result.frameRate.den})`,
    `Frame duration:    ${result.ticksPerFrame} ticks`,
    `Raw silence runs:  ${result.rawRegionCount}`,
    `Final cut regions: ${result.regions.length}`,
    `Dropped:           ${result.dropped.length}`,
    "",
  ];
  for (const r of result.regions) {
    lines.push(
      `#${r.index + 1}`,
      `  Detected:  ${range(r.detected)}`,
      `  Refined:   ${range(r.refined)}   (floor ${r.floorDb.toFixed(1)} dB)`,
      `  Padded:    ${range(r.padded)}`,
      `  Frames:    ${r.startFrame} → ${r.endFrame}   (${r.endFrame - r.startFrame} frames removed)`,
      `  Ticks:     ${r.startTicks} → ${r.endTicks}`,
    );
  }
  for (const d of result.dropped) lines.push(`dropped  ${range(d.detected)}  — ${d.reason}`);
  return lines.join("\n");
}
