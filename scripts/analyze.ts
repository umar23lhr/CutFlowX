import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { CutFlowXError, DEFAULT_SETTINGS, type DetectionSettings } from "../src/audio/audioTypes";
import { parseWav } from "../src/audio/wavReader";
import { formatDiagnostics } from "../src/cutting/diagnostics";
import { analyzeSilence } from "../src/engine";
import { FRAME_RATES, type FrameRate } from "../src/premiere/timecode";

const FPS: Record<string, FrameRate> = {
  "23.976": FRAME_RATES.fps23_976, "24": FRAME_RATES.fps24, "25": FRAME_RATES.fps25,
  "29.97": FRAME_RATES.fps29_97, "30": FRAME_RATES.fps30, "50": FRAME_RATES.fps50,
  "59.94": FRAME_RATES.fps59_94, "60": FRAME_RATES.fps60,
};

function main(argv: string[]): void {
  const file = argv.find((a, i) => !a.startsWith("--") && !(argv[i - 1]?.startsWith("--") ?? false));
  if (!file) {
    console.error("Usage: <file.wav> [--fps 29.97] [--threshold -32] [--min 500] [--before 80] [--after 100]");
    process.exit(1);
  }
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = opt(name);
    if (raw === undefined) return fallback;
    const v = Number(raw);
    if (!Number.isFinite(v)) throw new CutFlowXError(`--${name} must be a number (got "${raw}").`);
    return v;
  };
  const fpsKey = opt("fps") ?? "25";
  const frameRate = FPS[fpsKey];
  if (!frameRate) throw new CutFlowXError(`Unsupported --fps "${fpsKey}". Use one of: ${Object.keys(FPS).join(", ")}`);
  const settings: DetectionSettings = {
    thresholdDb: num("threshold", DEFAULT_SETTINGS.thresholdDb),
    minSilenceMs: num("min", DEFAULT_SETTINGS.minSilenceMs),
    paddingBeforeMs: num("before", DEFAULT_SETTINGS.paddingBeforeMs),
    paddingAfterMs: num("after", DEFAULT_SETTINGS.paddingAfterMs),
  };
  const audio = parseWav(readFileSync(file));
  const t0 = performance.now();
  const result = analyzeSilence(audio, settings, frameRate);
  const elapsed = performance.now() - t0;
  console.log(formatDiagnostics(result, basename(file)));
  console.log(
    `\n${result.regions.length} SILENCES DETECTED\n` +
      `Total silence:      ${result.detectedSilenceSec.toFixed(1)} sec\n` +
      `Estimated removal:  ${result.removableSec.toFixed(1)} sec\n` +
      `Analysis time:      ${elapsed.toFixed(0)} ms`,
  );
}

try {
  main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CutFlowXError) console.error(`\n${err.message}${err.detail ? `\n(${err.detail})` : ""}`);
  else console.error(err);
  process.exit(1);
}