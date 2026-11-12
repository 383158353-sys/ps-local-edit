/**
 * Model copies for the 影词魔方 optimize bridge only.
 * The stored selection and reference data URLs stay untouched so generation
 * still sends the original image. Generate-side size limits are a separate path.
 *
 * A full-document selection is stored as an uncompressed PNG. At ~6k px that
 * data URL is tens of megabytes; UXP fetch then fails before the bridge can
 * answer, and that used to be reported as “影词魔方没有运行”. The local bridge
 * accepts 14MB per image and 26MB per request. Copies stay well under that:
 * longest side 2048, JPEG, about 1.2MB each, only when the original would not fit.
 */

const OFFLINE_MESSAGE = '影词魔方没有运行。请从开始菜单打开「影词魔方」后再点优化。';
const UPLOAD_MESSAGE = '图片太大，传到影词魔方失败了。请缩小选区，或减少参考图后再点优化。';

const LIMITS = {
  maxEdge: 2048,
  maxImageBytes: 1_200_000,
  maxTotalBytes: 6 * 1024 * 1024
};

const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i;
const QUALITIES = [85, 78, 70, 62];
const EDGES = [2048, 1600, 1280, 1024, 768];

function estimatedBytes(dataUrl) {
  const match = typeof dataUrl === 'string' ? DATA_URL.exec(dataUrl) : null;
  if (!match) return typeof dataUrl === 'string' ? dataUrl.length : 0;
  const b64 = match[2];
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(b64.length * 3 / 4) - pad);
}

function nodeBuffer() {
  return typeof Buffer !== 'undefined' && typeof Buffer.from === 'function' ? Buffer : null;
}

function decodeBase64(b64) {
  const buffer = nodeBuffer();
  if (buffer) return new Uint8Array(buffer.from(b64, 'base64'));
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const out = new Uint8Array(Math.max(0, Math.floor(b64.length * 3 / 4) - pad));
  let offset = 0;
  for (let i = 0; i < b64.length; i += 4096) {
    const part = atob(b64.slice(i, Math.min(b64.length, i + 4096)));
    for (let j = 0; j < part.length; j++) out[offset++] = part.charCodeAt(j) & 255;
  }
  return out;
}

function bytesToBase64(bytes) {
  const buffer = nodeBuffer();
  if (buffer) return buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + 8192));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function readU32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function sniffSize(dataUrl) {
  try {
    const match = DATA_URL.exec(dataUrl);
    if (!match) return null;
    const header = decodeBase64(match[2].slice(0, 8192));
    if (header.length >= 24 && header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71) {
      return {width: readU32(header, 16), height: readU32(header, 20)};
    }
    if (header.length >= 4 && header[0] === 0xff && header[1] === 0xd8) {
      let p = 2;
      while (p + 8 < header.length) {
        if (header[p] !== 0xff) { p++; continue; }
        const marker = header[p + 1];
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          return {height: (header[p + 5] << 8) | header[p + 6], width: (header[p + 7] << 8) | header[p + 8]};
        }
        if (marker === 0xda || marker === 0xd9) break;
        const length = (header[p + 2] << 8) | header[p + 3];
        if (length < 2) break;
        p += 2 + length;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function fit(width, height, maxEdge) {
  const longest = Math.max(width, height);
  if (!(width > 0) || !(height > 0)) throw new Error('bad size');
  if (longest <= maxEdge) return {width, height};
  const scale = maxEdge / longest;
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale))};
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(filter, row, prev, bpp) {
  if (filter === 0) return;
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = prev ? prev[i] : 0;
    const ul = prev && i >= bpp ? prev[i - bpp] : 0;
    let add = 0;
    if (filter === 1) add = left;
    else if (filter === 2) add = up;
    else if (filter === 3) add = (left + up) >> 1;
    else if (filter === 4) add = paeth(left, up, ul);
    else throw new Error('png filter');
    row[i] = (row[i] + add) & 255;
  }
}

function finishAverage(acc, counts, width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i] || 1;
    rgba[i * 4] = Math.round(acc[i * 4] / n);
    rgba[i * 4 + 1] = Math.round(acc[i * 4 + 1] / n);
    rgba[i * 4 + 2] = Math.round(acc[i * 4 + 2] / n);
    rgba[i * 4 + 3] = Math.round(acc[i * 4 + 3] / n);
  }
  return rgba;
}

function parsePng(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('not png');
  let p = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const spans = [];
  while (p + 12 <= bytes.length) {
    const len = readU32(bytes, p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const start = p + 8;
    if (start + len + 4 > bytes.length) throw new Error('bad png chunk');
    if (type === 'IHDR') {
      width = readU32(bytes, start);
      height = readU32(bytes, start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === 'IDAT') spans.push({start, end: start + len});
    else if (type === 'IEND') break;
    p = start + len + 4;
  }
  if (!width || !height || !spans.length) throw new Error('png missing data');
  return {width, height, bitDepth, colorType, interlace, spans};
}

function makeCursor(bytes, spans) {
  let si = 0, off = 0;
  const spanLen = () => spans[si].end - spans[si].start;
  return {
    readByte() {
      while (si < spans.length && off >= spanLen()) { si++; off = 0; }
      if (si >= spans.length) throw new Error('png eof');
      return bytes[spans[si].start + off++];
    },
    readInto(target) {
      let filled = 0;
      while (filled < target.length) {
        while (si < spans.length && off >= spanLen()) { si++; off = 0; }
        if (si >= spans.length) throw new Error('png eof');
        const n = Math.min(spanLen() - off, target.length - filled);
        target.set(bytes.subarray(spans[si].start + off, spans[si].start + off + n), filled);
        off += n;
        filled += n;
      }
    }
  };
}

class BitReader {
  constructor(cursor) { this.cursor = cursor; this.buf = 0; this.n = 0; }
  bits(count) {
    let value = 0;
    for (let i = 0; i < count; i++) {
      if (this.n === 0) { this.buf = this.cursor.readByte(); this.n = 8; }
      value |= (this.buf & 1) << i;
      this.buf >>= 1;
      this.n--;
    }
    return value;
  }
  align() { this.n = 0; }
  readByte() {
    if (this.n) this.n = 0;
    return this.cursor.readByte();
  }
  readInto(target) {
    if (this.n) this.n = 0;
    this.cursor.readInto(target);
  }
}

function buildTree(lengths) {
  const max = lengths.reduce((m, len) => Math.max(m, len), 0);
  const counts = new Array(max + 1).fill(0);
  for (const len of lengths) if (len) counts[len]++;
  const nextCode = new Array(max + 1).fill(0);
  let code = 0;
  for (let len = 1; len <= max; len++) {
    code = (code + counts[len - 1]) << 1;
    nextCode[len] = code;
  }
  const root = {};
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (!len) continue;
    let node = root;
    const bits = nextCode[len]++;
    for (let i = len - 1; i >= 0; i--) {
      const key = ((bits >> i) & 1) ? 'right' : 'left';
      if (i === 0) node[key] = {sym};
      else node = node[key] || (node[key] = {});
    }
  }
  return root;
}

function readSymbol(bits, tree) {
  let node = tree;
  while (node && node.sym === undefined) node = bits.bits(1) ? node.right : node.left;
  if (!node || node.sym === undefined) throw new Error('bad huffman');
  return node.sym;
}

const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CL_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

function fixedTrees() {
  const lit = new Array(288).fill(0);
  for (let i = 0; i <= 143; i++) lit[i] = 8;
  for (let i = 144; i <= 255; i++) lit[i] = 9;
  for (let i = 256; i <= 279; i++) lit[i] = 7;
  for (let i = 280; i <= 287; i++) lit[i] = 8;
  return {lit: buildTree(lit), dist: buildTree(new Array(32).fill(5))};
}
const FIXED = fixedTrees();

class GrowBuffer {
  constructor() { this.buf = new Uint8Array(1024); this.len = 0; }
  push(value) {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(Math.min(this.buf.length * 2, 96 * 1024 * 1024));
      if (next.length === this.buf.length) throw new Error('png too large');
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = value;
  }
  copyFrom(distance, length) {
    if (distance < 1 || distance > this.len) throw new Error('bad distance');
    for (let i = 0; i < length; i++) this.push(this.buf[this.len - distance]);
  }
  bytes() { return this.buf.subarray(0, this.len); }
}

function inflateCodes(bits, grow, lit, dist) {
  for (;;) {
    const sym = readSymbol(bits, lit);
    if (sym < 256) grow.push(sym);
    else if (sym === 256) return;
    else {
      const len = LEN_BASE[sym - 257] + (LEN_EXTRA[sym - 257] ? bits.bits(LEN_EXTRA[sym - 257]) : 0);
      const dsym = readSymbol(bits, dist);
      const distance = DIST_BASE[dsym] + (DIST_EXTRA[dsym] ? bits.bits(DIST_EXTRA[dsym]) : 0);
      grow.copyFrom(distance, len);
    }
  }
}

function readDynamic(bits) {
  const hlit = bits.bits(5) + 257;
  const hdist = bits.bits(5) + 1;
  const hclen = bits.bits(4) + 4;
  const clen = new Array(19).fill(0);
  for (let i = 0; i < hclen; i++) clen[CL_ORDER[i]] = bits.bits(3);
  const tree = buildTree(clen);
  const lengths = [];
  while (lengths.length < hlit + hdist) {
    const sym = readSymbol(bits, tree);
    if (sym < 16) lengths.push(sym);
    else if (sym === 16) {
      const prev = lengths[lengths.length - 1];
      const rep = bits.bits(2) + 3;
      for (let i = 0; i < rep; i++) lengths.push(prev);
    } else if (sym === 17) {
      const rep = bits.bits(3) + 3;
      for (let i = 0; i < rep; i++) lengths.push(0);
    } else {
      const rep = bits.bits(7) + 11;
      for (let i = 0; i < rep; i++) lengths.push(0);
    }
  }
  return {lit: buildTree(lengths.slice(0, hlit)), dist: buildTree(lengths.slice(hlit, hlit + hdist))};
}

function inflateRaw(bits) {
  const grow = new GrowBuffer();
  let final = 0;
  do {
    final = bits.bits(1);
    const type = bits.bits(2);
    if (type === 0) {
      bits.align();
      const len = bits.readByte() | (bits.readByte() << 8);
      const nlen = bits.readByte() | (bits.readByte() << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('bad stored length');
      const block = new Uint8Array(len);
      if (len) bits.readInto(block);
      for (let i = 0; i < len; i++) grow.push(block[i]);
    } else if (type === 1) inflateCodes(bits, grow, FIXED.lit, FIXED.dist);
    else if (type === 2) {
      const trees = readDynamic(bits);
      inflateCodes(bits, grow, trees.lit, trees.dist);
    } else throw new Error('bad deflate');
  } while (!final);
  return grow.bytes();
}

function inflateZlibBytes(bytes) {
  if (bytes.length < 2 || (bytes[0] & 15) !== 8) throw new Error('zlib');
  const cursor = {i: (bytes[1] & 32) ? 6 : 2, readByte() { if (this.i >= bytes.length) throw new Error('zlib eof'); return bytes[this.i++]; }, readInto(target) { if (this.i + target.length > bytes.length) throw new Error('zlib eof'); target.set(bytes.subarray(this.i, this.i + target.length)); this.i += target.length; }};
  return inflateRaw(new BitReader(cursor));
}

function scanlinesToImage(raw, width, height, channels, maxEdge) {
  const rowBytes = width * channels;
  const stride = rowBytes + 1;
  if (raw.length < stride * height) throw new Error('png short');
  const fitted = fit(width, height, maxEdge);
  const down = fitted.width !== width || fitted.height !== height;
  const rgba = down ? null : new Uint8Array(width * height * 4);
  const acc = down ? new Uint32Array(fitted.width * fitted.height * 4) : null;
  const counts = down ? new Uint32Array(fitted.width * fitted.height) : null;
  const prev = new Uint8Array(rowBytes);
  const row = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    row.set(raw.subarray(y * stride + 1, y * stride + 1 + rowBytes));
    unfilter(filter, row, y ? prev : null, channels);
    if (down) accumulateRow(row, y, width, height, fitted, channels, acc, counts);
    else if (channels === 4) rgba.set(row, y * width * 4);
    else {
      let d = y * width * 4;
      for (let x = 0; x < width; x++) { rgba[d++] = row[x * 3]; rgba[d++] = row[x * 3 + 1]; rgba[d++] = row[x * 3 + 2]; rgba[d++] = 255; }
    }
    prev.set(row);
  }
  return down ? {width: fitted.width, height: fitted.height, rgba: finishAverage(acc, counts, fitted.width, fitted.height)} : {width, height, rgba};
}

function accumulateRow(row, y, width, height, fitted, channels, acc, counts) {
  const dy = Math.min(fitted.height - 1, Math.floor(y * fitted.height / height));
  const base = dy * fitted.width;
  for (let x = 0; x < width; x++) {
    const dx = Math.min(fitted.width - 1, Math.floor(x * fitted.width / width));
    const di = (base + dx) * 4;
    const si = x * channels;
    if (channels === 4) { acc[di] += row[si]; acc[di + 1] += row[si + 1]; acc[di + 2] += row[si + 2]; acc[di + 3] += row[si + 3]; }
    else { acc[di] += row[si]; acc[di + 1] += row[si + 1]; acc[di + 2] += row[si + 2]; acc[di + 3] += 255; }
    counts[base + dx]++;
  }
}

function readStoredRows(bits, bfinal, width, height, channels, maxEdge) {
  const state = {remain: 0, final: bfinal, needHeader: false};
  const read = target => {
    let filled = 0;
    while (filled < target.length) {
      if (state.remain === 0) {
        if (state.needHeader) {
          if (state.final) throw new Error('png truncated');
          state.final = bits.bits(1);
          if (bits.bits(2) !== 0) throw new Error('mixed deflate');
        }
        state.needHeader = true;
        bits.align();
        const len = bits.readByte() | (bits.readByte() << 8);
        const nlen = bits.readByte() | (bits.readByte() << 8);
        if ((len ^ 0xffff) !== nlen) throw new Error('bad stored length');
        state.remain = len;
        if (!len) continue;
      }
      const n = Math.min(state.remain, target.length - filled);
      bits.readInto(target.subarray(filled, filled + n));
      state.remain -= n;
      filled += n;
    }
  };
  const fitted = fit(width, height, maxEdge);
  const down = fitted.width !== width || fitted.height !== height;
  const rowBytes = width * channels;
  const rgba = down ? null : new Uint8Array(width * height * 4);
  const acc = down ? new Uint32Array(fitted.width * fitted.height * 4) : null;
  const counts = down ? new Uint32Array(fitted.width * fitted.height) : null;
  const prev = new Uint8Array(rowBytes);
  const row = new Uint8Array(rowBytes);
  const filter = new Uint8Array(1);
  for (let y = 0; y < height; y++) {
    read(filter);
    read(row);
    unfilter(filter[0], row, y ? prev : null, channels);
    if (down) accumulateRow(row, y, width, height, fitted, channels, acc, counts);
    else if (channels === 4) rgba.set(row, y * width * 4);
    else {
      let d = y * width * 4;
      for (let x = 0; x < width; x++) { rgba[d++] = row[x * 3]; rgba[d++] = row[x * 3 + 1]; rgba[d++] = row[x * 3 + 2]; rgba[d++] = 255; }
    }
    prev.set(row);
  }
  return down ? {width: fitted.width, height: fitted.height, rgba: finishAverage(acc, counts, fitted.width, fitted.height)} : {width, height, rgba};
}

function decodePng(bytes, maxEdge = Infinity) {
  const png = parsePng(bytes);
  if (png.bitDepth !== 8 || png.interlace || (png.colorType !== 2 && png.colorType !== 6)) throw new Error('png unsupported');
  const channels = png.colorType === 6 ? 4 : 3;
  const cursor = makeCursor(bytes, png.spans);
  const cmf = cursor.readByte();
  const flg = cursor.readByte();
  if ((cmf & 15) !== 8) throw new Error('png zlib');
  if (flg & 32) cursor.readInto(new Uint8Array(4));
  const bits = new BitReader(cursor);
  const bfinal = bits.bits(1);
  const btype = bits.bits(2);
  if (btype === 0) return readStoredRows(bits, bfinal, png.width, png.height, channels, maxEdge);
  let total = 0;
  for (const span of png.spans) total += span.end - span.start;
  const idat = new Uint8Array(total);
  let offset = 0;
  for (const span of png.spans) { idat.set(bytes.subarray(span.start, span.end), offset); offset += span.end - span.start; }
  return scanlinesToImage(inflateZlibBytes(idat), png.width, png.height, channels, maxEdge);
}

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
];
const QUANT_Y = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
const QUANT_C = [17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99];
const DC_LUM_BITS = [0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0];
const DC_CHROM_BITS = [0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0];
const DC_VAL = [0,1,2,3,4,5,6,7,8,9,10,11];
const AC_LUM_BITS = [0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d];
const AC_CHROM_BITS = [0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,0x77];
const AC_LUM_VAL = [0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa];
const AC_CHROM_VAL = [0x00,0x01,0x02,0x03,0x11,0x04,0x05,0x21,0x31,0x06,0x12,0x41,0x51,0x07,0x61,0x71,0x13,0x22,0x32,0x81,0x08,0x14,0x42,0x91,0xa1,0xb1,0xc1,0x09,0x23,0x33,0x52,0xf0,0x15,0x62,0x72,0xd1,0x0a,0x16,0x24,0x34,0xe1,0x25,0xf1,0x17,0x18,0x19,0x1a,0x26,0x27,0x28,0x29,0x2a,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa];

function buildHuffman(bits, values) {
  const codes = new Map();
  let code = 0, index = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length - 1]; i++) {
      codes.set(values[index++], {code, length});
      code++;
    }
    code <<= 1;
  }
  if (index !== values.length) throw new Error('jpeg huffman table');
  return codes;
}

const HUFF_DC_Y = buildHuffman(DC_LUM_BITS, DC_VAL);
const HUFF_DC_C = buildHuffman(DC_CHROM_BITS, DC_VAL);
const HUFF_AC_Y = buildHuffman(AC_LUM_BITS, AC_LUM_VAL);
const HUFF_AC_C = buildHuffman(AC_CHROM_BITS, AC_CHROM_VAL);
if (HUFF_DC_Y.get(0).length !== 2 || HUFF_DC_Y.get(0).code !== 0) throw new Error('jpeg dc table');
if (HUFF_AC_Y.get(0x00).length !== 4 || HUFF_AC_Y.get(0x00).code !== 0b1010) throw new Error('jpeg eob');

const COS = new Float64Array(64);
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) COS[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);

function scaleQuant(base, quality) {
  const q = Math.max(1, Math.min(100, quality | 0));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  const out = new Uint16Array(64);
  for (let i = 0; i < 64; i++) out[i] = Math.max(1, Math.min(255, Math.floor((base[i] * scale + 50) / 100)));
  return out;
}

class BitWriter {
  constructor() { this.bytes = []; this.acc = 0; this.n = 0; }
  write(value, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >>> i) & 1);
      if (++this.n === 8) this.push(this.acc);
    }
  }
  push(byte) {
    this.bytes.push(byte & 255);
    if ((byte & 255) === 0xff) this.bytes.push(0);
    this.acc = 0;
    this.n = 0;
  }
  flush() {
    if (!this.n) return;
    const pad = 8 - this.n;
    this.push((this.acc << pad) | ((1 << pad) - 1));
  }
}

function push16(out, value) { out.push((value >> 8) & 255, value & 255); }

function emitDht(out, classId, bits, values) {
  out.push(0xff, 0xc4);
  push16(out, 2 + 1 + 16 + values.length);
  out.push(classId);
  for (const count of bits) out.push(count);
  for (const value of values) out.push(value);
}

function emitDqt(out, id, table) {
  out.push(0xff, 0xdb);
  push16(out, 67);
  out.push(id);
  for (let k = 0; k < 64; k++) out.push(table[ZIGZAG[k]]);
}

function bitCount(value) {
  let v = Math.abs(value), n = 0;
  while (v) { n++; v >>= 1; }
  return n;
}

function amplitude(value, category) {
  return value < 0 ? value + ((1 << category) - 1) : value;
}

function encodeBlock(writer, zz, dcTable, acTable, prev, component) {
  const diff = zz[0] - prev[component];
  prev[component] = zz[0];
  const dcCat = bitCount(diff);
  const dc = dcTable.get(dcCat);
  writer.write(dc.code, dc.length);
  if (dcCat) writer.write(amplitude(diff, dcCat), dcCat);
  let run = 0;
  for (let i = 1; i < 64; i++) {
    if (!zz[i]) { run++; continue; }
    while (run >= 16) { const zrl = acTable.get(0xf0); writer.write(zrl.code, zrl.length); run -= 16; }
    const cat = bitCount(zz[i]);
    const ac = acTable.get((run << 4) | cat);
    writer.write(ac.code, ac.length);
    writer.write(amplitude(zz[i], cat), cat);
    run = 0;
  }
  if (run) { const eob = acTable.get(0); writer.write(eob.code, eob.length); }
}

function encodeJpeg(rgba, width, height, quality) {
  const yQuant = scaleQuant(QUANT_Y, quality);
  const cQuant = scaleQuant(QUANT_C, quality);
  const out = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  emitDqt(out, 0, yQuant);
  emitDqt(out, 1, cQuant);
  out.push(0xff, 0xc0);
  push16(out, 17);
  out.push(8);
  push16(out, height);
  push16(out, width);
  out.push(3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1);
  emitDht(out, 0x00, DC_LUM_BITS, DC_VAL);
  emitDht(out, 0x10, AC_LUM_BITS, AC_LUM_VAL);
  emitDht(out, 0x01, DC_CHROM_BITS, DC_VAL);
  emitDht(out, 0x11, AC_CHROM_BITS, AC_CHROM_VAL);
  out.push(0xff, 0xda);
  push16(out, 12);
  out.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0);
  const writer = new BitWriter();
  const spatial = new Float64Array(64);
  const tmp = new Float64Array(64);
  const dct = new Float64Array(64);
  const zz = new Int16Array(64);
  const prev = [0, 0, 0];
  const blocksX = Math.ceil(width / 8), blocksY = Math.ceil(height / 8);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      for (let c = 0; c < 3; c++) {
        const quant = c === 0 ? yQuant : cQuant;
        const x0 = bx * 8, y0 = by * 8;
        for (let y = 0; y < 8; y++) {
          const sy = Math.min(height - 1, y0 + y);
          for (let x = 0; x < 8; x++) {
            const sx = Math.min(width - 1, x0 + x);
            const p = (sy * width + sx) * 4;
            const alpha = rgba[p + 3] / 255;
            const r = rgba[p] * alpha + 255 * (1 - alpha);
            const g = rgba[p + 1] * alpha + 255 * (1 - alpha);
            const b = rgba[p + 2] * alpha + 255 * (1 - alpha);
            // JFIF stores Y, Cb, Cr. The level shift below removes the chroma offset of 128.
            const sample = c === 0 ? 0.299 * r + 0.587 * g + 0.114 * b
              : c === 1 ? 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
              : 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
            spatial[y * 8 + x] = sample - 128;
          }
        }
        for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
          let sum = 0;
          for (let x = 0; x < 8; x++) sum += spatial[y * 8 + x] * COS[u * 8 + x];
          tmp[y * 8 + u] = sum;
        }
        for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
          let sum = 0;
          const cv = v === 0 ? 0.7071067811865476 : 1;
          const cu = u === 0 ? 0.7071067811865476 : 1;
          for (let y = 0; y < 8; y++) sum += tmp[y * 8 + u] * COS[v * 8 + y];
          dct[v * 8 + u] = 0.25 * cu * cv * sum;
        }
        for (let k = 0; k < 64; k++) {
          const i = ZIGZAG[k];
          let q = Math.round(dct[i] / quant[i]);
          if (q > 1023) q = 1023;
          else if (q < -1023) q = -1023;
          zz[k] = q;
        }
        encodeBlock(writer, zz, c === 0 ? HUFF_DC_Y : HUFF_DC_C, c === 0 ? HUFF_AC_Y : HUFF_AC_C, prev, c);
      }
    }
  }
  writer.flush();
  const jpeg = new Uint8Array(out.length + writer.bytes.length + 2);
  jpeg.set(out, 0);
  for (let i = 0; i < writer.bytes.length; i++) jpeg[out.length + i] = writer.bytes[i];
  jpeg[jpeg.length - 2] = 0xff;
  jpeg[jpeg.length - 1] = 0xd9;
  return jpeg;
}

function jpegSize(bytes) {
  let p = 2;
  while (p + 9 < bytes.length) {
    if (bytes[p] !== 0xff) break;
    const marker = bytes[p + 1];
    if (marker === 0xc0 || marker === 0xc2) return {height: (bytes[p + 5] << 8) | bytes[p + 6], width: (bytes[p + 7] << 8) | bytes[p + 8]};
    const length = (bytes[p + 2] << 8) | bytes[p + 3];
    if (length < 2) break;
    p += 2 + length;
  }
  return null;
}

function edgeSteps(maxEdge, width, height) {
  const longest = Math.max(width, height);
  const steps = [];
  for (const edge of [maxEdge, ...EDGES]) {
    if (edge >= 64 && edge <= maxEdge && edge <= longest && !steps.includes(edge)) steps.push(edge);
  }
  if (!steps.length) steps.push(Math.max(1, Math.min(maxEdge, longest)));
  return steps;
}

function encodeUntilFit(bitmap, budget, maxEdge) {
  for (const edge of edgeSteps(maxEdge, bitmap.width, bitmap.height)) {
    const fitted = fit(bitmap.width, bitmap.height, edge);
    const rgba = fitted.width === bitmap.width && fitted.height === bitmap.height
      ? bitmap.rgba
      : resizeRgba(bitmap.rgba, bitmap.width, bitmap.height, fitted.width, fitted.height);
    for (const quality of QUALITIES) {
      const jpeg = encodeJpeg(rgba, fitted.width, fitted.height, quality);
      if (jpeg.length <= budget) return `data:image/jpeg;base64,${bytesToBase64(jpeg)}`;
    }
  }
  throw new Error(UPLOAD_MESSAGE);
}

function resizeRgba(src, sw, sh, dw, dh) {
  const acc = new Uint32Array(dw * dh * 4);
  const counts = new Uint32Array(dw * dh);
  for (let y = 0; y < sh; y++) {
    const dy = Math.min(dh - 1, Math.floor(y * dh / sh));
    for (let x = 0; x < sw; x++) {
      const dx = Math.min(dw - 1, Math.floor(x * dw / sw));
      const si = (y * sw + x) * 4;
      const di = (dy * dw + dx) * 4;
      acc[di] += src[si]; acc[di + 1] += src[si + 1]; acc[di + 2] += src[si + 2]; acc[di + 3] += src[si + 3];
      counts[dy * dw + dx]++;
    }
  }
  return finishAverage(acc, counts, dw, dh);
}

async function decodeWithCanvas(dataUrl, maxEdge) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const probe = document.createElement('canvas');
  if (!probe || typeof probe.getContext !== 'function' || !probe.getContext('2d')) return null;
  const img = document.createElement('img');
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('图片无法解码'));
    img.src = dataUrl;
  });
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  if (!(sw > 0) || !(sh > 0)) return null;
  const fitted = fit(sw, sh, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, fitted.width, fitted.height);
  ctx.drawImage(img, 0, 0, fitted.width, fitted.height);
  if (typeof ctx.getImageData === 'function') {
    return {width: fitted.width, height: fitted.height, rgba: ctx.getImageData(0, 0, fitted.width, fitted.height).data};
  }
  return null;
}

async function loadBitmap(data, maxEdge, decode) {
  if (typeof decode === 'function') return decode(data, maxEdge);
  const payload = DATA_URL.exec(data);
  if (payload) {
    const bytes = decodeBase64(payload[2]);
    if (bytes[0] === 137 && bytes[1] === 80) return decodePng(bytes, maxEdge);
  }
  const canvas = await decodeWithCanvas(data, maxEdge);
  if (canvas) return canvas;
  throw new Error('图片无法解码');
}

function outputName(name, dataUrl) {
  const ext = /^data:image\/jpeg/i.test(dataUrl) ? 'jpg' : /^data:image\/webp/i.test(dataUrl) ? 'webp' : 'png';
  const base = String(name || '图片').replace(/\.(png|jpe?g|webp)$/i, '');
  return `${base || '图片'}.${ext}`.slice(0, 150);
}

async function compressOne(image, {maxEdge, budget, decode}) {
  const data = typeof image?.data === 'string' ? image.data : '';
  const size = estimatedBytes(data);
  const dims = sniffSize(data);
  const valid = DATA_URL.test(data);
  const tooHeavy = !valid || size > budget;
  const tooWide = !!(dims && Math.max(dims.width, dims.height) > maxEdge);
  if (!tooHeavy && !tooWide) return {name: image.name, data};
  try {
    const bitmap = await loadBitmap(data, maxEdge, decode);
    const encoded = encodeUntilFit(bitmap, budget, maxEdge);
    if (estimatedBytes(encoded) > budget) throw new Error(UPLOAD_MESSAGE);
    return {name: outputName(image.name, encoded), data: encoded};
  } catch (error) {
    if (!tooHeavy && valid && size <= budget) return {name: image.name, data};
    if (error && error.message === UPLOAD_MESSAGE) throw error;
    throw new Error(UPLOAD_MESSAGE);
  }
}

async function prepareOptimizeImages(images, options = {}) {
  if (!Array.isArray(images)) throw new Error(UPLOAD_MESSAGE);
  const maxEdge = options.maxEdge || LIMITS.maxEdge;
  const maxImageBytes = options.maxImageBytes || LIMITS.maxImageBytes;
  const maxTotalBytes = options.maxTotalBytes || LIMITS.maxTotalBytes;
  const out = [];
  let total = 0;
  for (const image of images) {
    const budget = Math.min(maxImageBytes, maxTotalBytes - total);
    if (budget < 256) throw new Error(UPLOAD_MESSAGE);
    const copy = await compressOne(image, {maxEdge, budget, decode: options.decode});
    const size = estimatedBytes(copy.data);
    if (size > budget) throw new Error(UPLOAD_MESSAGE);
    total += size;
    out.push(copy);
  }
  return out;
}

module.exports = {
  OFFLINE_MESSAGE,
  UPLOAD_MESSAGE,
  LIMITS,
  estimatedBytes,
  decodePng,
  encodeJpeg,
  jpegSize,
  prepareOptimizeImages
};
