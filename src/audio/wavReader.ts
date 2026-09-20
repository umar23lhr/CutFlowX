import { CutFlowXError, type PcmAudio } from "./audioTypes";

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

/** Parses a RIFF/WAVE file into de-interleaved float channels. */
export function parseWav(input: ArrayBuffer | Uint8Array): PcmAudio {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (detail: string): never => {
    throw new CutFlowXError("The extracted audio could not be read.", `WAV: ${detail}`);
  };

  if (bytes.byteLength < 12 || fourCC(view, 0) !== "RIFF" || fourCC(view, 8) !== "WAVE") fail("not a RIFF/WAVE file");

  let format = -1;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16) fail("fmt chunk too small");
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE) {
        if (size < 40) fail("extensible fmt chunk too small");
        format = view.getUint16(body + 24, true); // first two bytes of the SubFormat GUID
      }
    } else if (id === "data") {
      dataOffset = body;
      // Streaming writers may leave the size as 0 or 0xFFFFFFFF: use what is actually there.
      const remaining = bytes.byteLength - body;
      dataSize = size === 0 || size === 0xffffffff || size > remaining ? remaining : size;
      break;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (format < 0) fail("missing fmt chunk");
  if (dataOffset < 0) fail("missing data chunk");
  if (channels < 1) fail("zero channels");
  if (sampleRate < 1) fail("zero sample rate");

  const bytesPerSample = bits / 8;
  const supported =
    (format === FORMAT_PCM && [8, 16, 24, 32].includes(bits)) || (format === FORMAT_FLOAT && (bits === 32 || bits === 64));
  if (!supported) fail(`unsupported format ${format} at ${bits}-bit`);

  const frameBytes = bytesPerSample * channels;
  const frames = Math.floor(dataSize / frameBytes);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));

  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const p = dataOffset + f * frameBytes + c * bytesPerSample;
      let v: number;
      if (format === FORMAT_FLOAT) {
        v = bits === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
      } else if (bits === 8) {
        v = (view.getUint8(p) - 128) / 128;
      } else if (bits === 16) {
        v = view.getInt16(p, true) / 32768;
      } else if (bits === 24) {
        const raw = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getUint8(p + 2) << 16);
        v = ((raw << 8) >> 8) / 8388608; // sign-extend 24 → 32 bit
      } else {
        v = view.getInt32(p, true) / 2147483648;
      }
      out[c]![f] = v;
    }
  }
  return { sampleRate, channels: out };
}
