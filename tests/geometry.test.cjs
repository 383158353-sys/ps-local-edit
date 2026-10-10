const assert = require('node:assert/strict');
const { test } = require('node:test');
const { closestStandardAspect, closestStandardImageSize, fitBoundsToAspect } = require('../plugin/modules/geometry');

test('chooses the nearest standard model ratio symmetrically for portrait and landscape selections', () => {
  assert.equal(closestStandardAspect(167, 359), '9:16');
  assert.equal(closestStandardAspect(359, 167), '16:9');
});

test('maps the selection long edge to the nearest standard generation size', () => {
  assert.equal(closestStandardImageSize(900, 1200), '1K');
  assert.equal(closestStandardImageSize(1800, 2400), '2K');
  assert.equal(closestStandardImageSize(3200, 1800), '4K');
});

test('expands the model reference crop to the selected standard ratio while containing the original selection', () => {
  const selection = { left: 300, top: 200, right: 467, bottom: 559 };
  const crop = fitBoundsToAspect(selection, 2009, 1135, '9:16', 8);
  assert.ok(crop);
  assert.equal(crop.width / crop.height, 9 / 16);
  assert.ok(crop.left <= selection.left && crop.top <= selection.top);
  assert.ok(crop.right >= selection.right && crop.bottom >= selection.bottom);
  assert.ok(crop.left >= 0 && crop.top >= 0 && crop.right <= 2009 && crop.bottom <= 1135);
});

test('returns no standardized crop when the selection cannot fit inside the document', () => {
  const selection = { left: 0, top: 0, right: 1000, bottom: 800 };
  assert.equal(fitBoundsToAspect(selection, 1000, 800, '9:16', 8), null);
});
