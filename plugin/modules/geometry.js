const STANDARD_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

function parseAspectRatio(value) {
  const match = String(value || '').match(/^(\d+):(\d+)$/);
  if (!match) return null;
  const width = Number(match[1]), height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height, value: width / height } : null;
}

function closestStandardAspect(width, height) {
  const actual = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 1;
  return STANDARD_ASPECT_RATIOS.reduce((best, candidate) => {
    const ratio = parseAspectRatio(candidate).value;
    return Math.abs(Math.log(ratio / actual)) < Math.abs(Math.log(parseAspectRatio(best).value / actual)) ? candidate : best;
  }, STANDARD_ASPECT_RATIOS[0]);
}

function closestStandardImageSize(width, height) {
  const longEdge = Math.max(Number(width) || 0, Number(height) || 0);
  if (longEdge <= 1448) return '1K';
  if (longEdge <= 2896) return '2K';
  return '4K';
}

function fitBoundsToAspect(selection, documentWidth, documentHeight, aspect, padding = 8) {
  const ratio = parseAspectRatio(aspect);
  if (!ratio || !selection || !(documentWidth > 0) || !(documentHeight > 0)) return null;
  const selectionWidth = Math.ceil(selection.right - selection.left);
  const selectionHeight = Math.ceil(selection.bottom - selection.top);
  if (selectionWidth < 1 || selectionHeight < 1) return null;

  const pad = Math.max(0, Math.round(Number(padding) || 0));
  const minScale = Math.max(Math.ceil(selectionWidth / ratio.width), Math.ceil(selectionHeight / ratio.height), 1);
  const maxScale = Math.floor(Math.min(documentWidth / ratio.width, documentHeight / ratio.height));
  if (minScale > maxScale) return null;

  const paddedScale = Math.max(Math.ceil((selectionWidth + pad * 2) / ratio.width), Math.ceil((selectionHeight + pad * 2) / ratio.height), minScale);
  const scale = Math.min(paddedScale, maxScale);
  const width = ratio.width * scale, height = ratio.height * scale;
  let left = Math.floor((selection.left + selection.right - width) / 2);
  let top = Math.floor((selection.top + selection.bottom - height) / 2);
  left = Math.max(0, Math.min(Math.floor(documentWidth - width), left));
  top = Math.max(0, Math.min(Math.floor(documentHeight - height), top));
  const result = { left, top, right: left + width, bottom: top + height, width, height };
  if (result.left > selection.left || result.top > selection.top || result.right < selection.right || result.bottom < selection.bottom) return null;
  return result;
}

module.exports = { STANDARD_ASPECT_RATIOS, parseAspectRatio, closestStandardAspect, closestStandardImageSize, fitBoundsToAspect };
