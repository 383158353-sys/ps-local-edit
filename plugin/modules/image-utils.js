/**
 * Image Processing Utilities Module
 * Handles in-memory image manipulation and conversion
 */

// The overlay is only a visual aid inside a card whose width is capped at 280 CSS px.
// Keeping a little extra resolution makes soft mask edges look good on high-DPI screens,
// while avoiding multi-megabyte buffers for Full Doc Mask captures.
const OVERLAY_PREVIEW_MAX_SIDE = 512;
const OVERLAY_OPACITY = 0.3;

// RELEASE SAFETY SWITCH
// ---------------------
// Photoshop 27.9 can throw a native `droverbindings_error` while an uncompressed
// ImageBlob is rendered by an <img>. That failure happens later on the native UXP
// TaskQueue, outside the JavaScript promise which created the ImageBlob, so a normal
// try/catch cannot reliably intercept it.
//
// Keep this `true` for the first production release: the preview uses a small,
// standards-compliant PNG data URL and never enters the problematic ImageBlob path.
// After the legacy renderer has been tested on more machines, changing this to
// `false` restores ImageBlob as the primary renderer with PNG as its JS fallback.
const USE_PNG_OVERLAY_AS_PRIMARY = true;

/**
 * Prepare mask data for encoding (fixes types, structure, components)
 * @param {object} maskData - Raw mask data from Photoshop
 * @returns {Promise<object>} Valid PhotoshopImageData object
 */
async function prepareMaskForEncoding(maskData) {
    const { imaging } = require('photoshop');

    // Debug: inspect full maskData structure
    console.log('prepareMaskForEncoding calling with maskData:', maskData ? 'present' : 'missing');

    // Try to find the actual image data and metadata
    let imgData, width, height, components, rowBytes;

    // 1. Try to handle PhotoshopImageData (has .getData() method)
    // Access nested imageData if present (standard structure from getSelection)
    const psImgData = (maskData.imageData && maskData.imageData.getData) ? maskData.imageData :
        (maskData.getData ? maskData : null);

    if (psImgData) {
        try {
            const rawData = await psImgData.getData();
            if (rawData) {
                // Ensure Uint8Array
                imgData = new Uint8Array(rawData);
            }

            width = psImgData.width || maskData.width;
            height = psImgData.height || maskData.height;
            components = psImgData.components || maskData.components || 1;
            rowBytes = psImgData.rowBytes || maskData.rowBytes;
        } catch (e) {
            console.error("Failed to getData from PhotoshopImageData:", e);
        }
    }

    // 2. Fallback to direct property access (if not a class instance or getData failed)
    if (!imgData) {
        if (maskData.imageData && (maskData.imageData instanceof Uint8Array || maskData.imageData.imageData)) {
            const src = maskData.imageData.imageData || maskData.imageData;
            if (src) imgData = new Uint8Array(src); // Ensure Uint8Array

            width = maskData.imageData.width || maskData.width;
            height = maskData.imageData.height || maskData.height;
            components = maskData.imageData.components || maskData.components || 1;
            rowBytes = maskData.imageData.rowBytes || maskData.rowBytes;
        } else {
            const src = maskData.imageData || maskData;
            if (src.byteLength || src.buffer) {
                imgData = new Uint8Array(src);
            } else {
                imgData = src;
            }

            width = maskData.width;
            height = maskData.height;
            components = maskData.components || 1;
            rowBytes = maskData.rowBytes;
        }
    }

    if (!imgData) {
        throw new Error("Could not extract image data from mask payload");
    }

    // Robust Heuristic V2 for RGB Mask Detection
    let inferred = components;

    // Check RowBytes (Stride)
    if (width && rowBytes) {
        const bpp = rowBytes / width;
        if (bpp >= 2.5 && bpp <= 4.5) {
            const rounded = Math.round(bpp);
            if (rounded === 3 || rounded === 4) {
                inferred = rounded;
            }
        }
    }

    // Check Data Size
    if (inferred === 1 && width && height && imgData.byteLength) {
        const ratio = imgData.byteLength / (width * height);
        if (ratio >= 2.5) {
            if (Math.abs(ratio - 3) < 0.6) inferred = 3;
            else if (Math.abs(ratio - 4) < 0.6) inferred = 4;
        }
    }

    if (inferred !== components) {
        components = inferred;
    }

    // Handle RowBytes/Stride padding if present
    const logicalRowBytes = width * components;

    if (rowBytes && rowBytes > logicalRowBytes) {
        const newBuffer = new Uint8Array(width * height * components);

        for (let y = 0; y < height; y++) {
            const srcStart = y * rowBytes;
            const srcEnd = srcStart + logicalRowBytes;
            const dstStart = y * logicalRowBytes;

            if (imgData.subarray) {
                newBuffer.set(imgData.subarray(srcStart, srcEnd), dstStart);
            } else {
                for (let x = 0; x < logicalRowBytes; x++) {
                    newBuffer[dstStart + x] = imgData[srcStart + x];
                }
            }
        }
        imgData = newBuffer;
    }

    // Check for Grayscale (1 component) and expand to RGB (3 components)
    if (components === 1) {
        const pixelCount = width * height;
        const rgbBuffer = new Uint8Array(pixelCount * 3);

        for (let i = 0; i < pixelCount; i++) {
            const val = (i < imgData.byteLength) ? imgData[i] : 0;
            rgbBuffer[i * 3] = val;     // R
            rgbBuffer[i * 3 + 1] = val; // G
            rgbBuffer[i * 3 + 2] = val; // B
        }

        imgData = rgbBuffer;
        components = 3;
    }

    // Create a valid object
    try {
        return await imaging.createImageDataFromBuffer(imgData, {
            width: width,
            height: height,
            components: components,
            chunky: true,
            colorSpace: 'RGB'
        });
    } catch (objErr) {
        console.error("Error creating PhotoshopImageData:", objErr);
        throw objErr;
    }
}

/**
 * Convert Mask Data to base64 string
 * @param {object} maskData - Raw mask data
 * @returns {Promise<string>} Base64 encoded PNG
 */
async function maskDataToBase64(maskData) {
    try {
        const { imaging } = require('photoshop');

        // Use shared logic to prepare mask data
        const validImageObj = await prepareMaskForEncoding(maskData);

        // Encode to PNG base64
        const pngData = await imaging.encodeImageData({
            imageData: validImageObj,
            base64: true
        });

        return pngData;
    } catch (error) {
        console.error('Error converting mask to base64:', error);
        return null;
    }
}

/**
 * Convert ImageData to base64 string for preview
 * Uses Photoshop's imaging API to encode
 * @param {object} imageObj - Image object from imaging API
 * @returns {Promise<string>}
 */
async function imageDataToBase64(imageObj) {
    try {
        // BYPASS: If the object is already a Base64 data URL string, return ONLY the base64 part.
        // This ensures callers like getPreviewDataUrl don't create double-prefixed strings.
        if (typeof imageObj === 'string' && imageObj.includes(';base64,')) {
            return imageObj.split(';base64,')[1];
        }
        if (imageObj && typeof imageObj.imageData === 'string' && imageObj.imageData.includes(';base64,')) {
            return imageObj.imageData.split(';base64,')[1];
        }

        const { imaging } = require('photoshop');

        // Encode to PNG — must specify format explicitly, otherwise API may default to JPEG
        // which cannot encode alpha channel (RGBA) data
        const pngData = await imaging.encodeImageData({
            imageData: imageObj.imageData || imageObj,
            format: 'image/png',
            base64: true
        });

        return pngData;
    } catch (error) {
        console.error('Error converting to base64:', error);
        // Return empty placeholder
        return '';
    }
}

/**
 * Calculate raster dimensions for a preview-only overlay.
 *
 * The aspect ratio is preserved so the overlay continues to line up with the source
 * image when both <img> elements use `object-fit: contain`.
 *
 * @param {number} width - Original mask width
 * @param {number} height - Original mask height
 * @param {boolean} compact - Whether the raster should be limited to maxSide
 * @param {number} maxSide - Maximum width or height of a compact raster
 * @returns {{width: number, height: number}}
 */
function getOverlayDimensions(width, height, compact, maxSide = OVERLAY_PREVIEW_MAX_SIDE) {
    if (!compact || Math.max(width, height) <= maxSide) {
        return { width, height };
    }

    const scale = maxSide / Math.max(width, height);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

/**
 * Downsample a mask by reading its first component with nearest-neighbour sampling.
 *
 * Selection masks are grayscale. Some Photoshop APIs expose them as one component,
 * while others expose the same grayscale value in RGB/RGBA. Reading the first
 * component handles both forms and keeps this helper independent from Photoshop's
 * image encoder.
 *
 * @param {Uint8Array} source - Source mask pixels
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} components - Components per source pixel
 * @param {number} rowBytes - Source bytes per row
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @returns {Uint8Array} One grayscale byte per target pixel
 */
function resizeMaskForPreview(source, sourceWidth, sourceHeight, components, rowBytes, targetWidth, targetHeight) {
    const result = new Uint8Array(targetWidth * targetHeight);

    for (let y = 0; y < targetHeight; y++) {
        const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / targetHeight));
        const sourceRow = sourceY * rowBytes;
        const targetRow = y * targetWidth;

        for (let x = 0; x < targetWidth; x++) {
            const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / targetWidth));
            result[targetRow + x] = source[sourceRow + sourceX * components];
        }
    }

    return result;
}

/**
 * Extract an 8-bit mask buffer without converting it through PhotoshopImageData.
 *
 * The normal capture path stores masks as a plain Uint8Array. The PhotoshopImageData
 * branch is retained for compatibility with callers which pass an Imaging API object.
 * Uint16/Float32 inputs are normalized only here, before the pure-JS PNG encoder runs.
 *
 * @param {object} maskData - Raw mask payload or PhotoshopImageData
 * @returns {Promise<{pixels: Uint8Array, width: number, height: number, components: number, rowBytes: number}>}
 */
async function getMaskPixels(maskData) {
    if (!maskData) {
        throw new Error('Mask data is missing');
    }

    const photoshopImageData = maskData.imageData && typeof maskData.imageData.getData === 'function'
        ? maskData.imageData
        : (typeof maskData.getData === 'function' ? maskData : null);

    const raw = photoshopImageData
        ? await photoshopImageData.getData()
        : (maskData.imageData && maskData.imageData.imageData
            ? maskData.imageData.imageData
            : maskData.imageData);

    if (!raw) {
        throw new Error('Could not extract pixels from mask data');
    }

    const width = photoshopImageData ? (photoshopImageData.width || maskData.width) : maskData.width;
    const height = photoshopImageData ? (photoshopImageData.height || maskData.height) : maskData.height;

    if (!width || !height) {
        throw new Error('Mask width or height is missing');
    }

    let pixels;
    if (raw instanceof Uint8Array) {
        pixels = raw;
    } else if (raw instanceof Uint16Array) {
        pixels = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            pixels[i] = Math.round(Math.min(32768, raw[i]) * 255 / 32768);
        }
    } else if (raw instanceof Float32Array) {
        pixels = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            pixels[i] = Math.round(Math.max(0, Math.min(1, raw[i])) * 255);
        }
    } else if (raw instanceof ArrayBuffer) {
        pixels = new Uint8Array(raw);
    } else {
        pixels = new Uint8Array(raw);
    }

    const inferredComponents = Math.max(1, Math.round(pixels.length / (width * height)));
    const components = photoshopImageData
        ? (photoshopImageData.components || maskData.components || inferredComponents)
        : (maskData.components || inferredComponents);

    // rowBytes belongs to the original component representation. After normalizing a
    // 16/32-bit typed array to Uint8 above, rows become tightly packed again.
    const canReuseRowBytes = raw instanceof Uint8Array || raw instanceof ArrayBuffer;
    const suppliedRowBytes = photoshopImageData
        ? (photoshopImageData.rowBytes || maskData.rowBytes)
        : maskData.rowBytes;
    const packedRowBytes = width * components;
    const rowBytes = canReuseRowBytes && suppliedRowBytes >= packedRowBytes
        ? suppliedRowBytes
        : packedRowBytes;

    if (pixels.length < rowBytes * height) {
        throw new Error('Mask pixel buffer is smaller than its declared dimensions');
    }

    return { pixels, width, height, components, rowBytes };
}

/**
 * Generate the overlay with the original uncompressed ImageBlob renderer.
 *
 * IMPORTANT: this is the previously released implementation. Its original behavior
 * remains the default (`compact = false`) so it can be tested or restored without
 * changing the algorithm. The optional compact mode only reduces the preview raster
 * before the existing RGBA/ImageBlob steps.
 *
 * @param {object} maskData - Raw mask data from Photoshop
 * @param {boolean} compact - Limit the largest side to 512 px when true
 * @returns {Promise<string|null>} Object URL for the overlay
 */
async function generateOverlayMask(maskData, compact = false) {
    try {
        // 1. Prepare Mask Data using shared logic
        const prepared = await prepareMaskForEncoding(maskData);
        // We need raw pixel data for ImageBlob
        // prepareMaskForEncoding returns a PhotoshopImageData object.
        let rgbData = await prepared.getData();
        let width = prepared.width;
        let height = prepared.height;

        const target = getOverlayDimensions(width, height, compact);
        if (target.width !== width || target.height !== height) {
            const grayscale = resizeMaskForPreview(
                rgbData,
                width,
                height,
                3,
                width * 3,
                target.width,
                target.height
            );
            const compactRgb = new Uint8Array(target.width * target.height * 3);
            for (let i = 0; i < grayscale.length; i++) {
                compactRgb[i * 3] = grayscale[i];
                compactRgb[i * 3 + 1] = grayscale[i];
                compactRgb[i * 3 + 2] = grayscale[i];
            }
            rgbData = compactRgb;
            width = target.width;
            height = target.height;
        }

        // 2. Create RGBA buffer
        const pixelCount = width * height;
        const rgbaBuffer = new Uint8Array(pixelCount * 4);

        for (let i = 0; i < pixelCount; i++) {
            // Mask is RGB (grayscale in 3 channels)
            const maskValue = rgbData[i * 3];

            // Set Color to Black (R=0, G=0, B=0)
            rgbaBuffer[i * 4] = 0;     // R
            rgbaBuffer[i * 4 + 1] = 0; // G
            rgbaBuffer[i * 4 + 2] = 0; // B

            // Transparency Logic:
            // Mask 255 (Selected) -> Alpha 0 (Fully Transparent Overlay)
            // Mask 0 (Unselected) -> Alpha ~153 (Semi-transparent Overlay)
            const alpha = (255 - maskValue) * OVERLAY_OPACITY;
            rgbaBuffer[i * 4 + 3] = Math.round(alpha);
        }

        // 3. Create ImageBlob (Special UXP Class for efficient image handling)
        if (typeof ImageBlob === 'undefined') {
            console.warn('ImageBlob API is not available in this UXP version.');
            return null;
        }

        const imageMetaData = {
            width: width,
            height: height,
            colorSpace: "RGB",
            pixelFormat: "RGBA",
            components: 4,      // RGBA
            componentSize: 8,   // 8 bits per channel
            hasAlpha: true,     // Vital for transparency
            type: "image/uncompressed"
        };

        const blob = new ImageBlob(rgbaBuffer, imageMetaData);

        // 4. Create Object URL
        const dataUrl = URL.createObjectURL(blob);

        return dataUrl;

    } catch (error) {
        console.error('Error generating overlay mask (ImageBlob):', error);
        // Return null so we don't break the main flow
        return null;
    }
}

/**
 * Write an unsigned 32-bit integer in PNG's big-endian byte order.
 */
function writeUint32BE(target, offset, value) {
    target[offset] = (value >>> 24) & 0xff;
    target[offset + 1] = (value >>> 16) & 0xff;
    target[offset + 2] = (value >>> 8) & 0xff;
    target[offset + 3] = value & 0xff;
}

let pngCrcTable = null;

/**
 * Build the standard CRC-32 lookup table used by PNG chunks.
 */
function getPngCrcTable() {
    if (pngCrcTable) return pngCrcTable;

    pngCrcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let value = n;
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        pngCrcTable[n] = value >>> 0;
    }
    return pngCrcTable;
}

/**
 * Calculate CRC-32 for a PNG chunk type followed by its data.
 */
function calculatePngCrc(typeBytes, data) {
    const table = getPngCrcTable();
    let crc = 0xffffffff;

    for (let i = 0; i < typeBytes.length; i++) {
        crc = table[(crc ^ typeBytes[i]) & 0xff] ^ (crc >>> 8);
    }
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Create one complete PNG chunk: length, four-byte type, data and CRC.
 */
function createPngChunk(type, data) {
    const typeBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);

    const chunk = new Uint8Array(12 + data.length);
    writeUint32BE(chunk, 0, data.length);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    writeUint32BE(chunk, 8 + data.length, calculatePngCrc(typeBytes, data));
    return chunk;
}

/**
 * Adler-32 checksum required at the end of a zlib stream.
 */
function calculateAdler32(data) {
    const MOD_ADLER = 65521;
    let a = 1;
    let b = 0;

    // Reducing every few thousand bytes avoids large floating-point accumulators while
    // remaining considerably faster than applying modulo for every byte.
    for (let start = 0; start < data.length; start += 5552) {
        const end = Math.min(start + 5552, data.length);
        for (let i = start; i < end; i++) {
            a += data[i];
            b += a;
        }
        a %= MOD_ADLER;
        b %= MOD_ADLER;
    }

    return ((b << 16) | a) >>> 0;
}

/**
 * Wrap bytes in a valid zlib stream using uncompressed DEFLATE blocks.
 *
 * Uncompressed blocks keep the encoder small and auditable. Because production
 * overlays are capped at 512 px, the resulting data URL stays small enough for the
 * panel. Each DEFLATE stored block is limited to 65,535 bytes by the format.
 */
function createUncompressedZlib(data) {
    const blockCount = Math.ceil(data.length / 65535);
    const output = new Uint8Array(2 + data.length + blockCount * 5 + 4);
    let outputOffset = 0;
    let inputOffset = 0;

    // CMF/FLG for DEFLATE with the fastest/no-compression level.
    output[outputOffset++] = 0x78;
    output[outputOffset++] = 0x01;

    while (inputOffset < data.length) {
        const length = Math.min(65535, data.length - inputOffset);
        const isFinal = inputOffset + length === data.length;
        const inverseLength = (~length) & 0xffff;

        output[outputOffset++] = isFinal ? 0x01 : 0x00;
        output[outputOffset++] = length & 0xff;
        output[outputOffset++] = (length >>> 8) & 0xff;
        output[outputOffset++] = inverseLength & 0xff;
        output[outputOffset++] = (inverseLength >>> 8) & 0xff;
        output.set(data.subarray(inputOffset, inputOffset + length), outputOffset);

        outputOffset += length;
        inputOffset += length;
    }

    writeUint32BE(output, outputOffset, calculateAdler32(data));
    return output;
}

/**
 * Join byte arrays without relying on Blob or another UXP image API.
 */
function concatenateBytes(parts) {
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

/**
 * Convert bytes to base64 in small chunks to avoid argument/stack limits.
 */
function bytesToBase64(bytes) {
    const CHUNK_SIZE = 0x8000;
    let binary = '';

    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
        const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
        binary += String.fromCharCode.apply(null, chunk);
    }

    if (typeof btoa !== 'undefined') return btoa(binary);
    if (typeof window !== 'undefined' && window.btoa) return window.btoa(binary);
    throw new Error('Base64 encoding is not available in this environment');
}

/**
 * Encode an indexed-color PNG for the mask overlay.
 *
 * Every palette entry is black; the tRNS table stores the corresponding opacity.
 * Therefore each output pixel needs only one palette index (the mask value), instead
 * of a four-byte RGBA pixel. This keeps even an uncompressed preview PNG lightweight.
 */
function encodeOverlayPng(maskPixels, width, height) {
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const ihdr = new Uint8Array(13);
    writeUint32BE(ihdr, 0, width);
    writeUint32BE(ihdr, 4, height);
    ihdr[8] = 8;  // 8 bits per palette index
    ihdr[9] = 3;  // Indexed-color PNG
    ihdr[10] = 0; // DEFLATE compression
    ihdr[11] = 0; // Adaptive filtering
    ihdr[12] = 0; // No interlace

    const palette = new Uint8Array(256 * 3); // All entries are black.
    const transparency = new Uint8Array(256);
    for (let maskValue = 0; maskValue < 256; maskValue++) {
        transparency[maskValue] = Math.round((255 - maskValue) * OVERLAY_OPACITY);
    }

    // PNG scanlines start with one filter byte. Filter 0 is ideal here because the
    // DEFLATE stream is intentionally stored without compression.
    const scanlines = new Uint8Array((width + 1) * height);
    for (let y = 0; y < height; y++) {
        const scanlineOffset = y * (width + 1);
        scanlines[scanlineOffset] = 0;
        scanlines.set(maskPixels.subarray(y * width, (y + 1) * width), scanlineOffset + 1);
    }

    const png = concatenateBytes([
        signature,
        createPngChunk('IHDR', ihdr),
        createPngChunk('PLTE', palette),
        createPngChunk('tRNS', transparency),
        createPngChunk('IDAT', createUncompressedZlib(scanlines)),
        createPngChunk('IEND', new Uint8Array(0))
    ]);

    return `data:image/png;base64,${bytesToBase64(png)}`;
}

/**
 * Generate a compact overlay as a standard PNG data URL without ImageBlob or
 * Photoshop's image encoder.
 *
 * This function is intentionally independent from the legacy renderer so either path
 * can be tested, called directly, or promoted to primary without rewriting the other.
 *
 * @param {object} maskData - Raw mask data from Photoshop
 * @param {boolean} compact - Limit the largest side to 512 px when true
 * @returns {Promise<string>} PNG data URL for an <img>
 */
async function generateOverlayMaskPng(maskData, compact = true) {
    const source = await getMaskPixels(maskData);
    const target = getOverlayDimensions(source.width, source.height, compact);
    const previewMask = resizeMaskForPreview(
        source.pixels,
        source.width,
        source.height,
        source.components,
        source.rowBytes,
        target.width,
        target.height
    );

    return encodeOverlayPng(previewMask, target.width, target.height);
}

/**
 * Run a renderer and call a separate fallback only for ordinary JavaScript failures.
 * Native TaskQueue failures are why production currently selects PNG before this helper.
 */
async function runOverlayRenderer(primary, fallback, rendererName) {
    let result = null;

    try {
        result = await primary();
    } catch (error) {
        console.error(`${rendererName} overlay renderer failed:`, error);
    }

    if (result || !fallback) return result;

    // The legacy function intentionally swallows its own errors and returns null
    // to protect capture. Treat that null exactly like a thrown JS error so the
    // separate fallback callback still gets its chance to render the overlay.
    try {
        return await fallback();
    } catch (fallbackError) {
        console.error('Fallback overlay renderer failed:', fallbackError);
        return null;
    }
}

/**
 * Production entry point for the small overlay shown in the FromPS preview.
 *
 * With the release safety switch enabled, only the PNG renderer is used. Once it is
 * disabled, the legacy ImageBlob renderer becomes primary and PNG is its callback
 * fallback for JavaScript-visible errors.
 */
async function generateOverlayMaskForPreview(maskData, compact = true) {
    if (USE_PNG_OVERLAY_AS_PRIMARY) {
        return runOverlayRenderer(
            () => generateOverlayMaskPng(maskData, compact),
            () => generateOverlayMask(maskData, compact),//null,
            'PNG'
        );
    }

    return runOverlayRenderer(
        () => generateOverlayMask(maskData, compact),
        () => generateOverlayMaskPng(maskData, compact),
        'ImageBlob'
    );
}

module.exports = {
    prepareMaskForEncoding,
    maskDataToBase64,
    imageDataToBase64,
    generateOverlayMask,
    generateOverlayMaskForPreview,
    // Exported only for isolated renderer testing. Production code calls it
    // through generateOverlayMaskForPreview(), which owns primary/fallback selection.
    generateOverlayMaskPng
};
