// Upload copies only. Local preview and layer restore keep the original data URL.
const jpeg = require('./jpeg-js');
// LK888 rejects a decoded file over 10MB and content/total over about 14MB.
const PER_FILE_DECODED = 10 * 1024 * 1024;
const AGGREGATE_DECODED = 14 * 1024 * 1024;
const AGGREGATE_ENCODED = 14 * 1024 * 1024;
const UPLOAD_BYTE_BUDGET = AGGREGATE_ENCODED;
const NOTE_ORIGINAL = '图片使用原图提交。';
const NOTE_LOSSLESS = '图片较大，已无损压缩后提交。';
const NOTE_JPEG = '图片较大，已用高质量 JPEG 轻度压缩后提交。';
const NOTE_SCALED = '图片较大，已按比例轻度缩小并压缩后提交。';

function readU32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}
function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function fromBase64(text) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function storedPngBytes(width, height, components) {
  const raw = height * (width * components + 1);
  const blocks = Math.ceil(raw / 65535) || 1;
  return 63 + raw + blocks * 5;
}
function inflateStored(bytes) {
  if (!bytes || bytes.length < 6 || bytes[0] !== 0x78) return null;
  let offset = 2;
  const parts = [];
  let total = 0;
  while (offset + 5 <= bytes.length - 4) {
    const header = bytes[offset];
    const final = header & 1;
    const type = (header >> 1) & 3;
    offset += 1;
    if (type !== 0) return null;
    const length = bytes[offset] | (bytes[offset + 1] << 8);
    offset += 4;
    if (offset + length > bytes.length) return null;
    parts.push(bytes.subarray(offset, offset + length));
    total += length;
    offset += length;
    if (final) break;
  }
  return total ? concatBytes(parts) : null;
}
function inflateZlib(bytes) {
  try { return require('zlib').inflateSync(bytes); }
  catch (_) { return null; }
}
function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left), du = Math.abs(estimate - up), dul = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dul) return left;
  return du <= dul ? up : upLeft;
}
function unfilter(raw, width, height, components) {
  const stride = width * components;
  const rowBytes = stride + 1;
  if (raw.length < height * rowBytes) return null;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * rowBytes];
    const src = raw.subarray(y * rowBytes + 1, y * rowBytes + 1 + stride);
    const dst = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    if (filter === 0) dst.set(src);
    else if (filter === 1) for (let i = 0; i < stride; i++) dst[i] = (src[i] + (i >= components ? dst[i - components] : 0)) & 255;
    else if (filter === 2) for (let i = 0; i < stride; i++) dst[i] = (src[i] + (prev ? prev[i] : 0)) & 255;
    else if (filter === 3) for (let i = 0; i < stride; i++) dst[i] = (src[i] + (((i >= components ? dst[i - components] : 0) + (prev ? prev[i] : 0)) >> 1)) & 255;
    else if (filter === 4) for (let i = 0; i < stride; i++) dst[i] = (src[i] + paeth(i >= components ? dst[i - components] : 0, prev ? prev[i] : 0, prev && i >= components ? prev[i - components] : 0)) & 255;
    else return null;
  }
  return out;
}
function toRGBA(pixels, width, height, components) {
  if (components === 4) return pixels;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    out[j] = pixels[i]; out[j + 1] = pixels[i + 1]; out[j + 2] = pixels[i + 2]; out[j + 3] = 255;
  }
  return out;
}
function decodePng(bytes) {
  if (!bytes || bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80) return null;
  let offset = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = readU32(data, 0); height = readU32(data, 4);
      if (data[8] !== 8 || data[10] !== 0) return null;
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const components = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!components || !width || !height) return null;
  const zlibBytes = concatBytes(idat);
  const raw = inflateStored(zlibBytes) || inflateZlib(zlibBytes);
  if (!raw) return null;
  const pixels = unfilter(raw, width, height, components);
  if (!pixels) return null;
  return { width, height, data: toRGBA(pixels, width, height, components) };
}
function decodeJpeg(bytes) {
  try {
    const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 120, maxMemoryUsageInMB: 1024 });
    if (!image || !image.width || !image.data) return null;
    return { width: image.width, height: image.height, data: image.data };
  } catch (_) { return null; }
}
function decodeDataUrl(url) {
  const match = typeof url === 'string' ? url.trim().match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i) : null;
  if (!match) return null;
  const bytes = fromBase64(match[2].replace(/\s+/g, ''));
  const kind = match[1].toLowerCase();
  if (kind === 'png') return decodePng(bytes);
  if (kind === 'jpeg' || kind === 'jpg') return decodeJpeg(bytes);
  return null;
}
function jpegDataUrl(data, width, height, quality) {
  const encoded = jpeg.encode({ data, width, height }, quality);
  return 'data:image/jpeg;base64,' + toBase64(encoded.data);
}
function boxDownscale(pixels, width, height, nextWidth, nextHeight) {
  const out = new Uint8Array(nextWidth * nextHeight * 4);
  for (let y = 0; y < nextHeight; y++) {
    const y0 = Math.floor(y * height / nextHeight);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / nextHeight));
    for (let x = 0; x < nextWidth; x++) {
      const x0 = Math.floor(x * width / nextWidth);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / nextWidth));
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const index = (yy * width + xx) * 4;
        r += pixels[index]; g += pixels[index + 1]; b += pixels[index + 2]; a += pixels[index + 3]; count++;
      }
      const dest = (y * nextWidth + x) * 4;
      out[dest] = r / count; out[dest + 1] = g / count; out[dest + 2] = b / count; out[dest + 3] = a / count;
    }
  }
  return out;
}
function frameAt(bitmap, scale) {
  if (scale === 1) return bitmap;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  return { width, height, data: boxDownscale(bitmap.data, bitmap.width, bitmap.height, width, height) };
}
function decodedBytes(url) {
  if (typeof url !== 'string') return 0;
  const comma = url.indexOf(',');
  const body = (comma >= 0 ? url.slice(comma + 1) : url).replace(/\s+/g, '');
  if (!body) return 0;
  const pad = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(body.length * 3 / 4) - pad);
}
function hasTransparency(data) {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function encodeDeflatedPng(bitmap) {
  let zlib;
  try { zlib = require('zlib'); } catch (_) { return null; }
  const transparent = hasTransparency(bitmap.data);
  const components = transparent ? 4 : 3;
  const stride = bitmap.width * components;
  const raw = new Uint8Array(bitmap.height * (stride + 1));
  for (let y = 0; y < bitmap.height; y++) {
    const dest = y * (stride + 1) + 1;
    if (components === 4) raw.set(bitmap.data.subarray(y * stride, (y + 1) * stride), dest);
    else for (let x = 0; x < bitmap.width; x++) {
      const source = (y * bitmap.width + x) * 4;
      const at = dest + x * 3;
      raw[at] = bitmap.data[source]; raw[at + 1] = bitmap.data[source + 1]; raw[at + 2] = bitmap.data[source + 2];
    }
  }
  const deflated = zlib.deflateSync(raw);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, bitmap.width); view.setUint32(4, bitmap.height);
  ihdr[8] = 8; ihdr[9] = components === 4 ? 6 : 2;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concatBytes([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflated), pngChunk('IEND', new Uint8Array())]);
}
function losslessUrl(bitmap) {
  const png = encodeDeflatedPng(bitmap);
  return png ? 'data:image/png;base64,' + toBase64(png) : '';
}
function fitsFile(url, perFile, encodedBudget) {
  return !!url && decodedBytes(url) <= perFile && url.length <= encodedBudget;
}
function compressToBudget(bitmap, perFile, encodedBudget, minEdge) {
  const transparent = hasTransparency(bitmap.data);
  const scales = [1, 0.9, 0.82, 0.74, 0.66, 0.58, 0.5];
  const qualities = [92, 86, 80];
  let best = null;
  const consider = (url, scaled, kind) => {
    if (!url) return null;
    const candidate = { url, scaled, kind: scaled ? 'scaled' : kind };
    if (!best || url.length < best.url.length) best = candidate;
    return fitsFile(url, perFile, encodedBudget) ? candidate : null;
  };
  for (const scale of scales) {
    const frame = frameAt(bitmap, scale);
    if (scale !== 1 && Math.min(frame.width, frame.height) < minEdge) continue;
    const scaled = scale !== 1;
    const lossless = consider(losslessUrl(frame), scaled, 'lossless');
    if (lossless) return lossless;
    if (!transparent || scale !== 1) {
      for (const quality of (scale === 1 ? qualities : [90])) {
        const encoded = consider(jpegDataUrl(frame.data, frame.width, frame.height, quality), scaled, 'jpeg');
        if (encoded) return encoded;
      }
    }
  }
  return best;
}
function resolveLimits(options = {}) {
  const limits = {
    perFileDecoded: PER_FILE_DECODED,
    aggregateDecoded: AGGREGATE_DECODED,
    aggregateEncoded: AGGREGATE_ENCODED,
    ...(options.limits || {})
  };
  if (options.targetBytes) limits.aggregateEncoded = Math.min(limits.aggregateEncoded, options.targetBytes);
  if (!options.targetBytes && !options.limits) {
    limits.perFileDecoded -= 256 * 1024;
    limits.aggregateDecoded -= 512 * 1024;
    limits.aggregateEncoded -= 512 * 1024;
  }
  return limits;
}
function usage(images, overhead) {
  let decoded = 0, encoded = overhead;
  const files = [];
  for (const image of images) {
    const file = decodedBytes(image);
    files.push(file);
    decoded += file;
    encoded += typeof image === 'string' ? image.length : 0;
  }
  return { decoded, encoded, files };
}
function overLimit(images, limits, overhead) {
  const total = usage(images, overhead);
  if (total.decoded > limits.aggregateDecoded || total.encoded > limits.aggregateEncoded) return true;
  return total.files.some(file => file > limits.perFileDecoded);
}
function fitUploadImages(images, options = {}) {
  const list = Array.isArray(images) ? images.slice() : [];
  const limits = resolveLimits(options);
  const minEdge = options.minEdge || 1600;
  const overhead = options.overheadBytes == null ? 8192 : options.overheadBytes;
  if (!overLimit(list, limits, overhead)) return { images: list, compressed: false, scaled: false, lossless: false, note: '' };
  const states = list.map(url => ({ url: typeof url === 'string' ? url : '', done: false, compressed: false, scaled: false, lossless: false }));
  let guard = 0;
  while (overLimit(states.map(state => state.url), limits, overhead) && guard < states.length + 2) {
    guard++;
    let index = -1;
    for (let i = 0; i < states.length; i++) if (!states[i].done && (index < 0 || decodedBytes(states[i].url) > decodedBytes(states[index].url))) index = i;
    if (index < 0) break;
    const bitmap = decodeDataUrl(states[index].url);
    if (!bitmap) { states[index].done = true; continue; }
    const others = states.filter((_, item) => item !== index).map(state => state.url);
    const otherUsage = usage(others, overhead);
    const perFile = limits.perFileDecoded;
    const encodedBudget = Math.max(1024, limits.aggregateEncoded - otherUsage.encoded);
    const decodedBudget = Math.max(1024, limits.aggregateDecoded - otherUsage.decoded);
    const compressed = compressToBudget(bitmap, Math.min(perFile, decodedBudget), encodedBudget, minEdge);
    if (!compressed || compressed.url.length >= states[index].url.length) { states[index].done = true; continue; }
    states[index].url = compressed.url;
    states[index].compressed = true;
    states[index].scaled = states[index].scaled || compressed.scaled;
    states[index].lossless = states[index].lossless || compressed.kind === 'lossless';
    states[index].done = fitsFile(compressed.url, Math.min(perFile, decodedBudget), encodedBudget);
  }
  if (overLimit(states.map(state => state.url), limits, overhead)) {
    const error = new Error('图片内容或总量仍超过平台限制。请缩小选区或减少参考图后再生成。');
    error.terminal = true;
    error.sizeRejected = true;
    throw error;
  }
  const compressed = states.some(state => state.compressed);
  const scaled = states.some(state => state.scaled);
  const lossless = compressed && states.filter(state => state.compressed).every(state => state.lossless);
  const note = !compressed ? '' : scaled ? NOTE_SCALED : lossless ? NOTE_LOSSLESS : NOTE_JPEG;
  return { images: states.map(state => state.url), compressed, scaled, lossless, note };
}
function parseSizeLimits(message) {
  const text = String(message || '');
  const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)\s*MB/gi)].map(match => Math.round(parseFloat(match[1]) * 1024 * 1024));
  const limits = {};
  if (!numbers.length) return limits;
  if (/解码|单文件|images\[\d+\]/i.test(text)) limits.perFileDecoded = numbers[0];
  if (/总量|请求体|内容或总量|合计/.test(text)) limits.aggregateEncoded = numbers[numbers.length - 1];
  if (/请求体过大/.test(text)) limits.aggregateEncoded = numbers[0];
  return limits;
}
function tightenLimits(limits) {
  const tighter = {};
  for (const key of Object.keys(limits || {})) if (limits[key] > 0) tighter[key] = Math.floor(limits[key] * 0.9);
  return tighter;
}
function isExplicitSizeRejection(message) {
  const text = String(message || '');
  if (/不确定|是否已接单|勿重复/.test(text)) return false;
  return /文件过大|解码后|不能超过|总量超过|请求体过大|内容或总量|超过\s*\d+(?:\.\d+)?\s*MB|payload too large|\b413\b/i.test(text);
}
function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value.trim());
}
module.exports = { UPLOAD_BYTE_BUDGET, PER_FILE_DECODED, AGGREGATE_DECODED, AGGREGATE_ENCODED, fitUploadImages, decodeDataUrl, decodedBytes, storedPngBytes, isImageDataUrl, parseSizeLimits, tightenLimits, isExplicitSizeRejection, NOTE_ORIGINAL, NOTE_JPEG, NOTE_SCALED, NOTE_LOSSLESS };
