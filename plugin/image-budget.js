// Upload copies only. Local preview and layer restore keep the original data URL.
const jpeg = require('./jpeg-js');
const UPLOAD_BYTE_BUDGET = 45 * 1024 * 1024;
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
function compressToBudget(bitmap, budget, minEdge) {
  const attempts = [{ scale: 1, quality: 92 }, { scale: 1, quality: 86 }, { scale: 1, quality: 80 }];
  for (const scale of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]) attempts.push({ scale, quality: 90 });
  let best = null;
  for (const attempt of attempts) {
    const frame = frameAt(bitmap, attempt.scale);
    if (attempt.scale !== 1 && Math.min(frame.width, frame.height) < minEdge) continue;
    const url = jpegDataUrl(frame.data, frame.width, frame.height, attempt.quality);
    const candidate = { url, scaled: attempt.scale !== 1, quality: attempt.quality, width: frame.width, height: frame.height };
    if (!best || url.length < best.url.length) best = candidate;
    if (url.length <= budget) return candidate;
  }
  return best;
}
function payloadLength(images, overhead) {
  return images.reduce((sum, image) => sum + (typeof image === 'string' ? image.length : 0), 0) + overhead;
}
function fitUploadImages(images, options = {}) {
  const list = Array.isArray(images) ? images.slice() : [];
  const target = options.targetBytes || UPLOAD_BYTE_BUDGET;
  const minEdge = options.minEdge || 1600;
  const overhead = options.overheadBytes == null ? 8192 : options.overheadBytes;
  if (payloadLength(list, overhead) <= target) return { images: list, compressed: false, scaled: false, note: '' };
  const states = list.map(url => ({ url: typeof url === 'string' ? url : '', done: false, compressed: false, scaled: false }));
  let guard = 0;
  while (payloadLength(states.map(state => state.url), overhead) > target && guard < states.length + 1) {
    guard++;
    let index = -1;
    for (let i = 0; i < states.length; i++) if (!states[i].done && (index < 0 || states[i].url.length > states[index].url.length)) index = i;
    if (index < 0) break;
    const bitmap = decodeDataUrl(states[index].url);
    if (!bitmap) { states[index].done = true; continue; }
    const others = states.reduce((sum, state, item) => sum + (item === index ? 0 : state.url.length), 0);
    const budget = Math.max(1024, target - overhead - others);
    const compressed = compressToBudget(bitmap, budget, minEdge);
    if (!compressed || compressed.url.length >= states[index].url.length) { states[index].done = true; continue; }
    states[index].url = compressed.url;
    states[index].compressed = true;
    states[index].scaled = states[index].scaled || compressed.scaled;
    states[index].done = compressed.url.length <= budget;
  }
  if (payloadLength(states.map(state => state.url), overhead) > target) {
    const error = new Error('图片仍超过平台约 50MB 上限。请缩小选区或减少参考图后再生成。');
    error.terminal = true;
    throw error;
  }
  const compressed = states.some(state => state.compressed);
  const scaled = states.some(state => state.scaled);
  return { images: states.map(state => state.url), compressed, scaled, note: compressed ? (scaled ? NOTE_SCALED : NOTE_JPEG) : '' };
}
function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value.trim());
}
module.exports = { UPLOAD_BYTE_BUDGET, fitUploadImages, decodeDataUrl, storedPngBytes, isImageDataUrl, NOTE_JPEG, NOTE_SCALED };
