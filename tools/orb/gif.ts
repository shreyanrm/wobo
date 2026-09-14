/**
 * GIF89a, written and read here rather than shelled out to a tool.
 *
 * Mail plays GIF and nothing else (docs/EMAILS-AND-ANIMATIONS.md §2), so the orb's moves have to
 * become GIFs — and the test that guards them has to be able to open one without a browser, a
 * binary on the machine or a package from the internet. Both directions live here for that reason,
 * and because the encoder and the decoder being the same 300 lines is what makes the guard honest:
 * the test reads the bytes that were actually written.
 *
 * The encoder does three things that keep a 480 px, ninety-four frame animation inside 600 KB:
 *   - one palette for the whole animation, by median cut over the colours that are really there
 *   - every frame after the first carries only the pixels that changed, in the smallest rectangle
 *     that holds them, with everything else transparent (disposal 1, "leave it be")
 *   - no dithering. The orb is flat ink on paper; dither noise would be new pixels in every frame
 *     and would cost more than the banding it prevents.
 */

export interface GifFrame {
  /** Straight RGBA, four bytes per pixel. */
  rgba: Uint8Array;
  /** Milliseconds. A GIF counts in centiseconds, so this is rounded to the nearest ten. */
  delayMs: number;
}

/** A byte from a typed array. The arrays are fully allocated, so a read past the end is a bug, not a hole. */
function byte(arr: Uint8Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new Error(`GIF read past the end at ${i}`);
  return v;
}

/** An element of a plain array. Every array here is filled to its length, so a miss is a bug, not a hole. */
function item<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`GIF read past the end at ${i}`);
  return v;
}

/** The colour at pixel offset `p` of a straight RGBA buffer, packed as 0xRRGGBB. */
function packed(rgba: Uint8Array, p: number): number {
  return (byte(rgba, p) << 16) | (byte(rgba, p + 1) << 8) | byte(rgba, p + 2);
}

// --- Writing ------------------------------------------------------------------------------------

class Bytes {
  private buf = new Uint8Array(1 << 16);
  private len = 0;
  private room(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  byte(v: number): void {
    this.room(1);
    this.buf[this.len] = v & 0xff;
    this.len += 1;
  }
  short(v: number): void {
    this.byte(v);
    this.byte(v >> 8);
  }
  bytes(v: ArrayLike<number>): void {
    this.room(v.length);
    this.buf.set(v as Uint8Array, this.len);
    this.len += v.length;
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i += 1) this.byte(s.charCodeAt(i));
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

interface Box {
  colors: number[];
  counts: number[];
}

const red = (c: number) => (c >> 16) & 0xff;
const green = (c: number) => (c >> 8) & 0xff;
const blue = (c: number) => c & 0xff;

function spread(box: Box): { channel: 0 | 1 | 2; size: number } {
  let rLo = 255;
  let gLo = 255;
  let bLo = 255;
  let rHi = 0;
  let gHi = 0;
  let bHi = 0;
  for (const c of box.colors) {
    const cr = red(c);
    const cg = green(c);
    const cb = blue(c);
    if (cr < rLo) rLo = cr;
    if (cr > rHi) rHi = cr;
    if (cg < gLo) gLo = cg;
    if (cg > gHi) gHi = cg;
    if (cb < bLo) bLo = cb;
    if (cb > bHi) bHi = cb;
  }
  const r = rHi - rLo;
  const g = gHi - gLo;
  const b = bHi - bLo;
  if (r >= g && r >= b) return { channel: 0, size: r };
  return g >= b ? { channel: 1, size: g } : { channel: 2, size: b };
}

/** Median cut, weighted by how often a colour actually appears. */
function palette(histogram: Map<number, number>, max: number): number[] {
  const colors = [...histogram.keys()];
  const counts = colors.map((c) => histogram.get(c) as number);
  if (colors.length <= max) return colors;
  let boxes: Box[] = [{ colors, counts }];
  while (boxes.length < max) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const candidate = item(boxes, i);
      if (candidate.colors.length < 2) continue;
      const s = spread(candidate);
      const weight = candidate.counts.reduce((a, b) => a + b, 0);
      const score = s.size * Math.log2(1 + weight);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    const box = item(boxes, best);
    const { channel } = spread(box);
    const pick = channel === 0 ? red : channel === 1 ? green : blue;
    const order = box.colors
      .map((c, i) => ({ c, n: item(box.counts, i) }))
      .sort((a, b) => pick(a.c) - pick(b.c));
    const total = order.reduce((a, x) => a + x.n, 0);
    // The cut sits at the population median, and the colour that crosses it goes to the right,
    // even when it is the last one: a box that is mostly one colour (the paper, the ink) with a
    // scatter of rare tints has to give that one colour a slot of its own. A cut that could never
    // reach the last colour peeled off one tint per split instead, and the palette was spent
    // before the colour most of the picture is made of ever got an entry.
    let seen = 0;
    let cut = order.length - 1;
    for (let i = 0; i < order.length; i += 1) {
      seen += item(order, i).n;
      if (seen * 2 >= total) {
        cut = Math.min(Math.max(i, 1), order.length - 1);
        break;
      }
    }
    const left = order.slice(0, cut);
    const right = order.slice(cut);
    boxes = [
      ...boxes.slice(0, best),
      { colors: left.map((x) => x.c), counts: left.map((x) => x.n) },
      { colors: right.map((x) => x.c), counts: right.map((x) => x.n) },
      ...boxes.slice(best + 1),
    ];
  }
  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < box.colors.length; i += 1) {
      const w = item(box.counts, i);
      const c = item(box.colors, i);
      r += red(c) * w;
      g += green(c) * w;
      b += blue(c) * w;
      n += w;
    }
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  });
}

function lzw(minCodeSize: number, indices: Uint8Array): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = new Bytes();
  const block: number[] = [];
  let bits = 0;
  let acc = 0;
  let width = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();
  const flush = (final: boolean) => {
    while (bits >= 8 || (final && bits > 0)) {
      block.push(acc & 0xff);
      acc >>= 8;
      bits = Math.max(0, bits - 8);
      if (block.length === 255) {
        out.byte(255);
        out.bytes(block);
        block.length = 0;
      }
    }
  };
  const emit = (code: number) => {
    acc |= code << bits;
    bits += width;
    flush(false);
  };
  emit(clear);
  let prefix = indices.length > 0 ? byte(indices, 0) : -1;
  for (let i = 1; i < indices.length; i += 1) {
    const k = byte(indices, i);
    const key = prefix * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    dict.set(key, next);
    next += 1;
    if (next > 4096) {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      width = minCodeSize + 1;
    } else if (next > 1 << width && width < 12) {
      width += 1;
    }
    prefix = k;
  }
  if (prefix >= 0) emit(prefix);
  emit(eoi);
  flush(true);
  if (block.length > 0) {
    out.byte(block.length);
    out.bytes(block);
  }
  out.byte(0);
  return out.done();
}

export interface EncodeOptions {
  /** How many colours the one shared palette may hold. One slot is always kept for transparency. */
  maxColors?: number;
}

export function encodeGif(
  width: number,
  height: number,
  frames: readonly GifFrame[],
  options: EncodeOptions = {},
): Uint8Array {
  if (frames.length === 0) throw new Error('a GIF with no frames is not an animation');
  const maxColors = Math.min(255, options.maxColors ?? 255);
  const histogram = new Map<number, number>();
  for (const frame of frames) {
    for (let i = 0; i < frame.rgba.length; i += 4) {
      const c = packed(frame.rgba, i);
      histogram.set(c, (histogram.get(c) ?? 0) + 1);
    }
  }
  const table = palette(histogram, maxColors);
  const transparent = table.length;
  const nearest = new Map<number, number>();
  for (const c of histogram.keys()) {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < table.length; i += 1) {
      const t = item(table, i);
      const dr = red(c) - red(t);
      const dg = green(c) - green(t);
      const db = blue(c) - blue(t);
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    nearest.set(c, best);
  }

  const out = new Bytes();
  out.ascii('GIF89a');
  out.short(width);
  out.short(height);
  // Global colour table, 8 bits per channel resolution, not sorted, 2^(n+1) entries.
  let bits = 1;
  while (1 << (bits + 1) < transparent + 1) bits += 1;
  const slots = 1 << (bits + 1);
  out.byte(0x80 | ((bits + 0) << 4) | bits);
  out.byte(0);
  out.byte(0);
  for (let i = 0; i < slots; i += 1) {
    const c = i < table.length ? item(table, i) : 0xffffff;
    out.byte(red(c));
    out.byte(green(c));
    out.byte(blue(c));
  }
  // Netscape 2.0: loop for ever. Without it a mail client plays the move once and stops.
  out.byte(0x21);
  out.byte(0xff);
  out.byte(11);
  out.ascii('NETSCAPE2.0');
  out.byte(3);
  out.byte(1);
  out.short(0);
  out.byte(0);

  const previous = new Uint8Array(width * height).fill(255);
  let first = true;
  for (const frame of frames) {
    const indices = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < indices.length; i += 1, p += 4) {
      const c = packed(frame.rgba, p);
      indices[i] = nearest.get(c) as number;
    }
    let x0 = 0;
    let y0 = 0;
    let x1 = width - 1;
    let y1 = height - 1;
    let sub: Uint8Array;
    if (first) {
      sub = indices;
      previous.set(indices);
      first = false;
    } else {
      x0 = width;
      y0 = height;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = y * width + x;
          if (indices[i] === previous[i]) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < x0) {
        // Nothing moved. One pixel, transparent, so the frame still spends its time on screen.
        x0 = 0;
        y0 = 0;
        x1 = 0;
        y1 = 0;
        sub = new Uint8Array([transparent]);
      } else {
        const w = x1 - x0 + 1;
        const h = y1 - y0 + 1;
        sub = new Uint8Array(w * h);
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const i = (y + y0) * width + (x + x0);
            const index = byte(indices, i);
            sub[y * w + x] = index === previous[i] ? transparent : index;
            previous[i] = index;
          }
        }
      }
    }
    const delay = Math.round(frame.delayMs / 10);
    out.byte(0x21);
    out.byte(0xf9);
    out.byte(4);
    // Disposal 1 (leave the frame in place) plus the transparent-index flag: that pair is what
    // makes a frame that carries only its changes legal.
    out.byte((1 << 2) | 1);
    out.short(delay);
    out.byte(transparent);
    out.byte(0);
    out.byte(0x2c);
    out.short(x0);
    out.short(y0);
    out.short(x1 - x0 + 1);
    out.short(y1 - y0 + 1);
    out.byte(0);
    out.byte(8);
    out.bytes(lzw(8, sub));
  }
  out.byte(0x3b);
  return out.done();
}

// --- Reading ------------------------------------------------------------------------------------

export interface DecodedFrame {
  delayMs: number;
  /** The whole canvas after this frame has been laid over the ones before it. */
  rgba: Uint8Array;
}

export interface DecodedGif {
  version: string;
  width: number;
  height: number;
  /** 0 means for ever; null means the file never said, which plays once. */
  loopCount: number | null;
  frameCount: number;
  durationMs: number;
  frames: DecodedFrame[];
}

function unlzw(minCodeSize: number, data: Uint8Array, pixels: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = new Uint8Array(pixels);
  let written = 0;
  let at = 0;
  let bits = 0;
  let acc = 0;
  let width = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i += 1) dict.push([i]);
    dict.push([]);
    dict.push([]);
    width = minCodeSize + 1;
  };
  reset();
  let previous: number[] | null = null;
  while (written < pixels) {
    while (bits < width) {
      if (at >= data.length) return out;
      acc |= byte(data, at) << bits;
      at += 1;
      bits += 8;
    }
    const code = acc & ((1 << width) - 1);
    acc >>= width;
    bits -= width;
    if (code === clear) {
      reset();
      previous = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length && (code < clear || code > eoi)) entry = item(dict, code);
    else if (code === dict.length && previous) entry = [...previous, item(previous, 0)];
    else break;
    for (let i = 0; i < entry.length && written < pixels; i += 1) {
      out[written] = item(entry, i);
      written += 1;
    }
    if (previous) {
      dict.push([...previous, item(entry, 0)]);
      if (dict.length === 1 << width && width < 12) width += 1;
    }
    previous = entry;
  }
  return out;
}

export interface DecodeOptions {
  /** Stop after this many frames; the header is still read in full. */
  maxFrames?: number;
}

export function decodeGif(bytes: Uint8Array, options: DecodeOptions = {}): DecodedGif {
  const version = String.fromCharCode(...bytes.subarray(0, 6));
  if (!version.startsWith('GIF')) throw new Error('not a GIF');
  /** A little-endian 16-bit field, the way every GIF header field is written. */
  const short = (i: number) => byte(bytes, i) | (byte(bytes, i + 1) << 8);
  /** One colour-table entry, three bytes, packed as 0xRRGGBB. */
  const rgb = (i: number) => (byte(bytes, i) << 16) | (byte(bytes, i + 1) << 8) | byte(bytes, i + 2);
  const width = short(6);
  const height = short(8);
  const flags = byte(bytes, 10);
  let at = 13;
  let table: number[] = [];
  if (flags & 0x80) {
    const size = 1 << ((flags & 0x07) + 1);
    table = new Array(size);
    for (let i = 0; i < size; i += 1) {
      table[i] = rgb(at);
      at += 3;
    }
  }
  const canvas = new Uint8Array(width * height * 4).fill(255);
  const frames: DecodedFrame[] = [];
  let loopCount: number | null = null;
  let delayMs = 0;
  let transparent = -1;
  let frameCount = 0;
  let durationMs = 0;
  const wanted = options.maxFrames ?? Number.POSITIVE_INFINITY;
  const skipBlocks = () => {
    while (byte(bytes, at) !== 0) at += byte(bytes, at) + 1;
    at += 1;
  };
  while (at < bytes.length) {
    const marker = byte(bytes, at);
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = byte(bytes, at + 1);
      at += 2;
      if (label === 0xf9) {
        const size = byte(bytes, at);
        const flagsPacked = byte(bytes, at + 1);
        delayMs = short(at + 2) * 10;
        transparent = flagsPacked & 1 ? byte(bytes, at + 4) : -1;
        at += size + 1;
        at += 1;
      } else if (label === 0xff) {
        const size = byte(bytes, at);
        const name = String.fromCharCode(...bytes.subarray(at + 1, at + 1 + size));
        at += size + 1;
        if (name === 'NETSCAPE2.0') {
          // One sub-block: [3][1][loop low][loop high]
          loopCount = short(at + 2);
        }
        skipBlocks();
      } else {
        skipBlocks();
      }
      continue;
    }
    if (marker !== 0x2c) break;
    const fx = short(at + 1);
    const fy = short(at + 3);
    const fw = short(at + 5);
    const fh = short(at + 7);
    const local = byte(bytes, at + 9);
    at += 10;
    let colours = table;
    if (local & 0x80) {
      const size = 1 << ((local & 0x07) + 1);
      colours = new Array(size);
      for (let i = 0; i < size; i += 1) {
        colours[i] = rgb(at);
        at += 3;
      }
    }
    const minCodeSize = byte(bytes, at);
    at += 1;
    const parts: number[] = [];
    while (byte(bytes, at) !== 0) {
      const size = byte(bytes, at);
      for (let i = 0; i < size; i += 1) parts.push(byte(bytes, at + 1 + i));
      at += size + 1;
    }
    at += 1;
    frameCount += 1;
    durationMs += delayMs;
    if (frames.length < wanted) {
      const indices = unlzw(minCodeSize, Uint8Array.from(parts), fw * fh);
      for (let y = 0; y < fh; y += 1) {
        for (let x = 0; x < fw; x += 1) {
          const index = byte(indices, y * fw + x);
          if (index === transparent) continue;
          const c = colours[index] ?? 0;
          const o = ((y + fy) * width + (x + fx)) * 4;
          canvas[o] = (c >> 16) & 0xff;
          canvas[o + 1] = (c >> 8) & 0xff;
          canvas[o + 2] = c & 0xff;
          canvas[o + 3] = 255;
        }
      }
      frames.push({ delayMs, rgba: canvas.slice() });
    }
  }
  return { version, width, height, loopCount, frameCount, durationMs, frames };
}
