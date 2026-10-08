/**
 * File System Operations Module
 * Handles file saving, loading, and temp storage for UXP
 */

const { storage } = require('uxp');
const fs = storage.localFileSystem;
const imageUtils = require('./image-utils.js');
const helper = require('./helper.js');

// Temp folder for intermediate files
let tempFolder = null;

/**
 * Get or create temp folder for plugin
 * @returns {Promise<Folder>}
 */
async function getTempFolder() {
    if (!tempFolder) {
        tempFolder = await fs.getTemporaryFolder();
    }
    return tempFolder;
}

/**
 * Save image data as PNG file with user dialog
 * @param {object} imageObj - Image object with imageData, width, height, components
 * @param {string} defaultName - Default file name
 * @returns {Promise<boolean>} Success status
 */
async function savePNG(imageObj, defaultName = 'capture.png') {
    try {
        const { imaging } = require('photoshop');

        // Get file location from user
        const file = await fs.getFileForSaving(defaultName, {
            types: ['png']
        });

        if (!file) {
            return false; // User cancelled
        }

        // Encode and save using Photoshop's imaging API
        const pngData = await imaging.encodeImageData({
            imageData: imageObj.imageData,
            base64: false
        });

        await file.write(pngData, { format: storage.formats.binary });

        return true;
    } catch (error) {
        console.error('Error saving PNG:', error);
        throw error;
    }
}

/**
 * Internal helper to save encoded image data to a specific File object
 * @private
 */
async function _saveImageDataToFile(file, imageDataObj, isMask = false) {
    const { imaging } = require('photoshop');

    let buffer;
    let width = imageDataObj.width;
    let height = imageDataObj.height;
    let components = imageDataObj.components || (isMask ? 1 : 4);

    if (isMask) {
        // Masks need special preparation (normalization)
        buffer = await imageUtils.prepareMaskForEncoding(imageDataObj);
    } else {
        buffer = imageDataObj.imageData;
    }

    // Encode to PNG using Photoshop imaging API
    const pngData = await imaging.encodeImageData({
        imageData: buffer,
        width: width,
        height: height,
        components: components,
        base64: false
    });

    // Write to file
    await file.write(pngData, { format: storage.formats.binary });
    return true;
}

/**
 * Save captured image to file with dialog
 * @param {object} capturePayload - The captured payload with imageData
 * @param {string} defaultName - Default filename
 * @returns {Promise<boolean>}
 */
async function saveImage(capturePayload, defaultName = 'capture.png') {
    try {
        const file = await fs.getFileForSaving(defaultName, {
            types: ['png']
        });

        if (!file) return false;

        // If we have cached PNG base64, write it directly — avoids re-encoding restored imageData
        if (capturePayload.imageBase64) {
            const pngBuffer = base64ToArrayBuffer(capturePayload.imageBase64);
            await file.write(pngBuffer, { format: storage.formats.binary });
            return true;
        }

        return await _saveImageDataToFile(file, capturePayload.imageData);
    } catch (error) {
        console.error('Error saving image:', error);
        throw error;
    }
}

/**
 * Save mask data as PNG file with user dialog
 * @param {object} maskData - Mask ImageData object
 * @param {string} defaultName - Default file name
 * @returns {Promise<boolean>}
 */
async function saveMask(maskData, defaultName = 'mask.png') {
    try {
        const file = await fs.getFileForSaving(defaultName, {
            types: ['png']
        });

        if (!file) return false;

        return await _saveImageDataToFile(file, maskData, true);
    } catch (error) {
        console.error('Error saving mask:', error);
        throw error;
    }
}

/**
 * Save both image and mask (single dialog for image, auto-save mask via helper)
 * @param {object} capturePayload 
 * @param {string} defaultName - Suggested name for the main image
 * @returns {Promise<{success: boolean, cancelled?: boolean, imageSaved?: boolean, maskSaved?: boolean, maskError?: string}>}
 */
async function saveImageAndMask(capturePayload, defaultName = 'capture.png') {
    try {
        // 1. Get location for the main image
        const imageFile = await fs.getFileForSaving(defaultName, {
            types: ['png']
        });

        if (!imageFile) {
            return { success: false, cancelled: true }; // User cancelled
        }

        // 2. Save the main image locally
        // If we have cached PNG base64, write it directly — avoids re-encoding restored imageData
        if (capturePayload.imageBase64) {
            const pngBuffer = base64ToArrayBuffer(capturePayload.imageBase64);
            await imageFile.write(pngBuffer, { format: storage.formats.binary });
        } else {
            await _saveImageDataToFile(imageFile, capturePayload.imageData);
        }

        // 3. Save the mask via helper (if exists)
        let maskSaved = true;
        let maskError = null;

        if (capturePayload.maskData) {
            // Construct mask path based on the chosen image path
            const imagePath = imageFile.nativePath;
            const lastDotIndex = imagePath.lastIndexOf('.');
            const basePath = lastDotIndex !== -1 ? imagePath.substring(0, lastDotIndex) : imagePath;
            const extension = lastDotIndex !== -1 ? imagePath.substring(lastDotIndex) : '.png';
            const maskPath = `${basePath}_mask${extension}`;

            // Convert mask to base64
            // We use the helper function logic which uses imageUtils
            const maskBase64 = await imageUtils.maskDataToBase64(capturePayload.maskData);

            // Save via helper (handles existence check and renaming)
            const saveResult = await helper.saveViaHelper(maskPath, maskBase64);
            if (!saveResult || !saveResult.success) {
                maskSaved = false;
                maskError = (saveResult && (saveResult.code || saveResult.error)) || 'FAILED';
            }
        }

        return {
            success: true,
            imageSaved: true,
            maskSaved,
            maskError
        };

    } catch (error) {
        console.error('Error saving image and mask:', error);
        throw error;
    }
}

/**
 * Convert Mask Data to base64 string for clipboard
 * @param {object} maskData - Raw mask data
 * @returns {Promise<string>} Base64 encoded PNG
 */
async function maskDataToBase64(maskData) {
    return imageUtils.maskDataToBase64(maskData);
}

/**
 * Load image file from user dialog
 * @returns {Promise<{file: File, arrayBuffer: ArrayBuffer, dataUrl: string}|null>}
 */
async function loadFile() {
    try {
        const files = await fs.getFileForOpening({
            types: ['png', 'jpg', 'jpeg']  //types: storage.fileTypes.images gives the same result, but with no value benefits
        });

        if (!files || files.length === 0) {
            return null; // User cancelled
        }

        const file = Array.isArray(files) ? files[0] : files;

        // Read file as binary
        const arrayBuffer = await file.read({ format: storage.formats.binary });

        // Convert to base64 data URL for preview
        const base64 = arrayBufferToBase64(arrayBuffer);
        const mimeType = file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${base64}`;

        const token = await fs.createSessionToken(file);

        return {
            file,
            arrayBuffer,
            dataUrl,
            nativePath: file.nativePath,
            token
        };
    } catch (error) {
        console.error('Error loading file:', error);
        throw error;
    }
}

/**
 * Convert ArrayBuffer to Base64 string
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Convert Base64 string to ArrayBuffer
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
    // Safety check: if a Data URL was passed, strip the prefix before decoding
    const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
    const binary = atob(cleanBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Convert ImageData to base64 string for preview
 * Uses Photoshop's imaging API to encode
 * @param {object} imageObj - Image object from imaging API
 * @returns {Promise<string>}
 */
async function imageDataToBase64(imageObj) {
    return imageUtils.imageDataToBase64(imageObj);
}

/**
 * Save result image to temp file for placing
 * @param {ArrayBuffer} arrayBuffer - Image data
 * @param {string} filename - Temp filename
 * @returns {Promise<string>} Native path to temp file
 */
async function saveToTemp(arrayBuffer, filename = 'temp_result.png') {
    try {
        const temp = await getTempFolder();
        const file = await temp.createFile(filename, { overwrite: true });
        await file.write(arrayBuffer, { format: storage.formats.binary });
        const token = await fs.createSessionToken(file);
        return { nativePath: file.nativePath, token };
    } catch (error) {
        console.error('Error saving to temp:', error);
        throw error;
    }
}

/**
 * Clean up temp files
 */
async function cleanupTemp() {
    // In UXP, temp files are auto-cleaned, but we can explicitly delete if needed
    tempFolder = null;
}

/**
 * Offload heavy pixel data from a capturedPayload to temp files to free memory.
 * Both imageData and maskData are plain wrapper objects with the actual pixel
 * buffer accessible at .imageData (Uint8Array or PhotoshopImageData inner object).
 * After this call, payload.imageData and payload.maskData will be null.
 * @param {object} payload - The capturedPayload object to offload
 * @returns {Promise<void>}
 */
async function offloadPayloadPixels(payload) {
    if (payload.imageData) {
        if (!payload.imageTempToken) {
            if (typeof payload.imageData === 'string') {
                // Second format: imageData is already a base64 Data URL string
                const rawBuffer = base64ToArrayBuffer(payload.imageData);
                const saved = await saveToTemp(rawBuffer, `capture_img_${Date.now()}.png`);
                payload.imageTempToken = saved.token;
                payload.isBase64Format = true; // Mark format for correct reloading
            } else {
                // First format: imageData is a PhotoshopImageData object
                const inner = payload.imageData.imageData || payload.imageData;
                const rawBuffer = inner.getData ? await inner.getData() : inner;
                const saved = await saveToTemp(rawBuffer, `capture_img_${Date.now()}.raw`);
                payload.imageTempToken = saved.token;
                payload.imageTempMeta = {
                    width: payload.bounds.width,
                    height: payload.bounds.height,
                    components: 4,
                    colorSpace: 'RGB',
                    colorProfile: 'sRGB IEC61966-2.1'
                };
            }
        }
        // Temp file already has valid data — just release memory
        payload.imageData = null;
    }
    if (payload.maskData) {
        if (!payload.maskTempToken) {
            // First offload — save raw mask buffer to temp file
            const rawBuffer = payload.maskData.imageData;
            const saved = await saveToTemp(rawBuffer, `capture_mask_${Date.now()}.raw`);
            payload.maskTempToken = saved.token;
            payload.maskTempMeta = {
                width: payload.maskData.width,
                height: payload.maskData.height,
                components: payload.maskData.components,
                sourceBounds: payload.maskData.sourceBounds
            };
        }
        // Temp file already has valid data — just release memory
        payload.maskData = null;
    }
}

/**
 * Reload pixel data from temp files back into a capturedPayload.
 * Restores imageData and maskData to the same wrapper structures as captureSelection() produces.
 * @param {object} payload - The capturedPayload to restore pixels into
 * @returns {Promise<void>}
 */
async function reloadPayloadPixels(payload) {
    const { imaging } = require('photoshop');

    if (payload.imageTempToken && !payload.imageData) {
        const entry = fs.getEntryForSessionToken(payload.imageTempToken);
        const rawBuffer = await entry.read({ format: storage.formats.binary });

        if (payload.isBase64Format) {
            // Second format: restore as base64 Data URL string
            const base64 = arrayBufferToBase64(rawBuffer);
            payload.imageData = `data:image/png;base64,${base64}`;
        } else {
            // First format: restore as PhotoshopImageData
            const psImageData = await imaging.createImageDataFromBuffer(new Uint8Array(rawBuffer), {
                ...payload.imageTempMeta,
                chunky: true  // RGBA data from getPixels() is always interleaved (chunky)
            });
            payload.imageData = psImageData;
        }
    }
    if (payload.maskTempToken && !payload.maskData) {
        const entry = fs.getEntryForSessionToken(payload.maskTempToken);
        const rawBuffer = await entry.read({ format: storage.formats.binary });
        // Restore as plain object matching ps.js captureSelection() output
        payload.maskData = {
            width: payload.maskTempMeta.width,
            height: payload.maskTempMeta.height,
            components: payload.maskTempMeta.components,
            imageData: new Uint8Array(rawBuffer),
            sourceBounds: payload.maskTempMeta.sourceBounds
        };
    }
}

/**
 * Get data URL from image data for preview display
 * @param {object} capturePayload - Capture result with imageData
 * @returns {Promise<string>} Data URL
 */
async function getPreviewDataUrl(capturePayload) {
    const base64 = await imageDataToBase64(capturePayload.imageData);
    if (!base64) return '';
    return `data:image/png;base64,${base64}`;
}

/**
 * Get mask preview data URL
 * @param {object} maskData - Mask image data
 * @returns {Promise<string>} Data URL
 */
async function getMaskPreviewDataUrl(maskData) {
    const base64 = await imageDataToBase64(maskData);
    if (!base64) return '';
    return `data:image/png;base64,${base64}`;
}

module.exports = {
    savePNG,
    saveImage,
    saveMask,
    saveImageAndMask,
    loadFile,
    arrayBufferToBase64,
    base64ToArrayBuffer,
    imageDataToBase64,
    saveToTemp,
    cleanupTemp,
    getPreviewDataUrl,
    getMaskPreviewDataUrl,
    maskDataToBase64,
    getTempFolder,
    generateOverlayMask: imageUtils.generateOverlayMask,
    offloadPayloadPixels,
    reloadPayloadPixels
};
