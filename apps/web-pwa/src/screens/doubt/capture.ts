/**
 * A photo from the camera or the file picker, made small and upright before it leaves the device.
 *
 * Two reasons, both the learner's: a 12 MB HEIC off a phone camera is a minute on a 2G link and
 * the brain reads a 1600 px page as well as a 4000 px one; and the fewer pixels leave the phone,
 * the less of a bedroom or a sibling goes with them. EXIF orientation is honoured by the decoder
 * (`createImageBitmap` with `imageOrientation: 'from-image'`), so what the brain reads is what the
 * learner saw through the viewfinder — and the region boxes it returns are in that upright frame.
 */

import type { Capture } from './api';

/** The longest edge that leaves the device. */
export const MAX_EDGE = 1600;
/** Bigger than this is a scan, and a scan should come one page at a time. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const JPEG_QUALITY = 0.86;

/** The size a `w × h` image takes when its longest edge is held to `max`. Never upscaled. */
export function fitWithin(w: number, h: number, max = MAX_EDGE): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export class CaptureRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureRefused';
  }
}

/** Is this something a camera or a picker could hand us as a page? */
export function acceptsFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!file.type.startsWith('image/'))
    return 'That is not a photo. A picture of the page works best.';
  if (file.size > MAX_FILE_BYTES)
    return 'That photo is bigger than I can read. Try one page at a time.';
  return null;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // HEIC on a browser that cannot decode it, or an option it does not know: fall through
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new CaptureRefused('I could not open that photo. Try another?'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode, downscale, re-encode as JPEG. Throws `CaptureRefused` with a line the learner can read. */
export async function captureFromFile(file: File): Promise<Capture> {
  const refusal = acceptsFile(file);
  if (refusal) throw new CaptureRefused(refusal);
  const source = await decode(file);
  const w = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const h = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const size = fitWithin(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new CaptureRefused('I could not open that photo. Try another?');
  ctx.drawImage(source, 0, 0, size.width, size.height);
  if ('close' in source) source.close();
  const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return {
    data: url.slice(url.indexOf(',') + 1),
    mediaType: 'image/jpeg',
    width: size.width,
    height: size.height,
  };
}

/** A data URL for an <img>, from a capture. */
export function captureUrl(capture: Pick<Capture, 'data' | 'mediaType'>): string {
  return `data:${capture.mediaType};base64,${capture.data}`;
}
