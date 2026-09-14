/**
 * A PNG reader, for the frames the browser hands us and for the test that checks them.
 *
 * Only the shapes a headless Chromium actually writes: 8-bit, non-interlaced, greyscale, RGB,
 * greyscale+alpha or RGBA. Anything else throws by name rather than decoding to nonsense, because a
 * silently wrong picture here would pass every assertion downstream.
 *
 * No dependency, on purpose: the still and the GIF are checked by `bun test`, which must not need a
 * browser, a codec or a network.
 */

import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  width: number;
  height: number;
  /** Straight RGBA, four bytes per pixel, row by row. */
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** A byte from a typed array. The arrays are fully allocated, so a read past the end is a bug, not a hole. */
function byte(arr: Uint8Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new Error(`PNG read past the end at ${i}`);
  return v;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(byte(bytes, at + 4), byte(bytes, at + 5), byte(bytes, at + 6), byte(bytes, at + 7));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = byte(bytes, at + 16);
      colorType = byte(bytes, at + 17);
      if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported here`);
      if (byte(bytes, at + 20) !== 0) throw new Error('interlaced PNG is not supported here');
      if (!CHANNELS[colorType]) throw new Error(`PNG colour type ${colorType} is not supported`);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  const channels = CHANNELS[colorType] ?? 0;
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const stride = width * channels;
  const lines = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = byte(raw, src);
    src += 1;
    const row = y * stride;
    const prior = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = byte(raw, src + x);
      const a = x >= channels ? byte(lines, row + x - channels) : 0;
      const b = y > 0 ? byte(lines, prior + x) : 0;
      const c = y > 0 && x >= channels ? byte(lines, prior + x - channels) : 0;
      let out: number;
      if (filter === 0) out = value;
      else if (filter === 1) out = value + a;
      else if (filter === 2) out = value + b;
      else if (filter === 3) out = value + ((a + b) >> 1);
      else if (filter === 4) out = value + paeth(a, b, c);
      else throw new Error(`unknown PNG filter ${filter}`);
      lines[row + x] = out & 0xff;
    }
    src += stride;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i += 1, p += channels) {
    const o = i * 4;
    if (colorType === 0) {
      rgba[o] = byte(lines, p);
      rgba[o + 1] = byte(lines, p);
      rgba[o + 2] = byte(lines, p);
      rgba[o + 3] = 255;
    } else if (colorType === 4) {
      rgba[o] = byte(lines, p);
      rgba[o + 1] = byte(lines, p);
      rgba[o + 2] = byte(lines, p);
      rgba[o + 3] = byte(lines, p + 1);
    } else {
      rgba[o] = byte(lines, p);
      rgba[o + 1] = byte(lines, p + 1);
      rgba[o + 2] = byte(lines, p + 2);
      rgba[o + 3] = colorType === 6 ? byte(lines, p + 3) : 255;
    }
  }
  return { width, height, rgba };
}
