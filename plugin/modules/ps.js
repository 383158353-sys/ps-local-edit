/**
 * Photoshop Operations Module
 * Handles all Photoshop API interactions: capture, place, mask, filters
 */

const { app, action, core, imaging, constants } = require('photoshop');
const settings = require('./settings.js');

/**
 * Check if there is an active document
 * @returns {boolean}
 */
function hasActiveDocument() {
    return app.documents.length > 0 && app.activeDocument !== null;
}

/**
 * Check if there is an active selection in the document
 * @returns {Promise<boolean>}
 */
async function hasActiveSelection() {
    if (!hasActiveDocument()) return false;

    try {
        const doc = app.activeDocument;
        // Use batchPlay to check selection state
        const result = await action.batchPlay([
            {
                _obj: "get",
                _target: [
                    { _property: "selection" },
                    { _ref: "document", _id: doc.id }
                ]
            }
        ], { synchronousExecution: false });

        // If selection exists, result will have selection property
        return result[0] && result[0].selection !== undefined;
    } catch (e) {
        // No selection exists
        return false;
    }
}

/**
 * Get the bounds of the current selection
 * @returns {Promise<{left: number, top: number, right: number, bottom: number, width: number, height: number}>}
 */
async function getSelectionBounds() {
    const doc = app.activeDocument;

    const result = await action.batchPlay([
        {
            _obj: "get",
            _target: [
                { _property: "selection" },
                { _ref: "document", _id: doc.id }
            ]
        }
    ], { synchronousExecution: false });

    if (!result[0] || !result[0].selection) {
        throw new Error("No active selection");
    }

    const sel = result[0].selection;

    // Selection bounds can come in different formats
    let bounds;
    if (sel.left !== undefined) {
        bounds = {
            left: sel.left._value ?? sel.left,
            top: sel.top._value ?? sel.top,
            right: sel.right._value ?? sel.right,
            bottom: sel.bottom._value ?? sel.bottom
        };
    } else if (sel._obj === "rectangle") {
        bounds = {
            left: sel.left._value ?? sel.left,
            top: sel.top._value ?? sel.top,
            right: sel.right._value ?? sel.right,
            bottom: sel.bottom._value ?? sel.bottom
        };
    } else {
        // Fallback: get from document selection
        const boundsResult = await action.batchPlay([
            {
                _obj: "get",
                _target: [
                    { _property: "bounds" },
                    { _ref: "channel", _enum: "channel", _value: "selection" },
                    { _ref: "document", _id: doc.id }
                ]
            }
        ], { synchronousExecution: false });

        if (boundsResult[0] && boundsResult[0].bounds) {
            const b = boundsResult[0].bounds;
            bounds = {
                left: b.left._value ?? b.left ?? 0,
                top: b.top._value ?? b.top ?? 0,
                right: b.right._value ?? b.right ?? 0,
                bottom: b.bottom._value ?? b.bottom ?? 0
            };
        } else {
            throw new Error("Cannot determine selection bounds");
        }
    }

    bounds.width = bounds.right - bounds.left;
    bounds.height = bounds.bottom - bounds.top;

    return bounds;
}

/**
 * Computes a human-readable aspect ratio label for the given dimensions.
 * - First tries an exact GCD reduction (e.g. 1920×1080 → "16:9").
 * - If the reduced form has large numbers (neither side ≤ 21), falls back
 *   to the closest standard ratio prefixed with "~" (e.g. "~16:9").
 * - Returns null only if both dimensions are 0.
 * @param {number} w
 * @param {number} h
 * @returns {string|null}
 */
function getDocAspectRatioLabel(w, h) {
    if (!w || !h) return null;
    // Euclidean GCD
    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    const g = gcd(w, h);
    const rW = w / g;
    const rH = h / g;
    if (rW <= 21 && rH <= 21) return `${rW}:${rH}`;
    // Fall back to closest standard ratio
    const STANDARD_RATIOS = [
        { name: '21:9', value: 21 / 9 }, { name: '2:1', value: 2 },
        { name: '16:9', value: 16 / 9 }, { name: '3:2', value: 3 / 2 },
        { name: '4:3', value: 4 / 3 }, { name: '5:4', value: 5 / 4 },
        { name: '1:1', value: 1 },
        { name: '4:5', value: 4 / 5 }, { name: '3:4', value: 3 / 4 },
        { name: '2:3', value: 2 / 3 }, { name: '9:16', value: 9 / 16 },
        { name: '1:2', value: 1 / 2 }, { name: '9:21', value: 9 / 21 },
    ];
    const actual = w / h;
    let best = null, minDiff = Infinity;
    for (const r of STANDARD_RATIOS) {
        const diff = Math.abs(actual - r.value);
        if (diff < minDiff) { minDiff = diff; best = r; }
    }
    return best ? `~${best.name}` : null;
}

/**
 * Capture the current selection with image and mask data
 * @param {string} sourceMode - 'copyMerged' or 'currentLayer'
 * @param {boolean} viaTempDocCreation - If true, uses a slower method that preserves transparency by creating a temporary document.
 * @returns {Promise<{imageData: ImageData, maskData: ImageData, bounds: object, context: object}>}
 */
async function captureSelection(sourceMode, viaTempDocCreation, fullDocMask = false, captureOptions = {}) {
    if (!hasActiveDocument()) {
        throw new Error("No active document");
    }

    if (!(await hasActiveSelection())) {
        throw new Error("No active selection");
    }

    // Wrap in executeAsModal for imaging API operations
    return await core.executeAsModal(async (executionContext) => {
        const doc = app.activeDocument;
        const activeLayer = doc.activeLayers[0];


        // Get selection bounds
        const bounds = await getSelectionBounds();

        // Get document dimensions
        const docWidth = doc.width;
        const docHeight = doc.height;

        let expandedBounds;
        let bestRatioName;

        if (fullDocMask) {
            // Full Doc Mask mode: use the entire document as the capture area.
            // The mask will be black (document) with white only at the selection area.
            expandedBounds = {
                left: 0,
                top: 0,
                right: docWidth,
                bottom: docHeight,
                width: docWidth,
                height: docHeight
            };
            const fullDocRatioLabel = getDocAspectRatioLabel(docWidth, docHeight);
            bestRatioName = `Full Doc ${fullDocRatioLabel ? ' ' + fullDocRatioLabel : ''}`;
            console.log('Full Doc Mask mode: expandedBounds set to entire document:', expandedBounds);
        } else {
            // 1. Set minimum padding
            const MIN_PADDING = 50;

            // Original selection dimensions
            const selLeft = Math.round(bounds.left);
            const selTop = Math.round(bounds.top);
            const selRight = Math.round(bounds.right);
            const selBottom = Math.round(bounds.bottom);
            const selWidth = (selRight - selLeft) || 1; // protection against zero width
            const selHeight = (selBottom - selTop) || 1;

            // Determine the center of the selection
            const centerX = selLeft + (selWidth / 2);
            const centerY = selTop + (selHeight / 2);

            // Target minimum dimensions of the bounds (current size + 50px on each side)
            const targetMinW = selWidth + (MIN_PADDING * 2);
            const targetMinH = selHeight + (MIN_PADDING * 2);

            // 2. Available aspect ratios depending on selection orientation
            // 1:1 square is always available
            const aspectRatios = [
                { name: '1:1', value: 1.0, weight: 1.0 }
            ];

            // Add enabled settings aspect ratios based on strict orientation
            const enabledConfigs = settings.getEnabledRatios();
            enabledConfigs.forEach((config, idx) => {
                const penalty = 1.0 + idx * 0.05; // 0th = 1.0, 1st = 1.05, 2nd = 1.10
                if (selWidth > selHeight) {
                    // aspectRatios.push({ name: '3:2', value: 1.5, weight: 1.0 });
                    // aspectRatios.push({ name: '16:9', value: 16 / 9, weight: 1.05 }); // +5% penalty
                    // aspectRatios.push({ name: '4:3', value: 4 / 3, weight: 1.1 }); // +10% penalty
                    aspectRatios.push({
                        name: config.landscapeName,
                        value: config.landscapeValue,
                        weight: penalty
                    });
                } else if (selWidth < selHeight) {
                    // aspectRatios.push({ name: '2:3', value: 2 / 3, weight: 1.0 });
                    // aspectRatios.push({ name: '9:16', value: 9 / 16, weight: 1.05 }); // +5% penalty
                    // aspectRatios.push({ name: '3:4', value: 3 / 4, weight: 1.1 }); // +10% penalty
                    aspectRatios.push({
                        name: config.portraitName,
                        value: config.portraitValue,
                        weight: penalty
                    });
                }
            });

            // 3. Choosing the best ratio — simulate full pipeline per candidate to guarantee
            // that the final captured dimensions will exactly match the reported aspect ratio.
            let bestW = targetMinW;  // Padded fallback (selection + padding, clamped later)
            let bestH = targetMinH;
            let minScore = Infinity;
            bestRatioName = "Padded"; // Default if no valid ratio fits within canvas

            // finalCoords: pre-computed exact pixel bounds from simulation (set only when a ratio wins)
            let finalCoords = null;

            // Only enforce aspect ratio if the document is large enough to support the target size at ALL
            // If the document is smaller than the selection + 100px padding, aspect ratio enforcement might look weird.
            const canFitAnyPadding = docWidth >= targetMinW || docHeight >= targetMinH;

            // If it's the whole document, we just return the document bounds without forcing an aspect ratio
            if (!canFitAnyPadding || (selWidth >= docWidth - 2 && selHeight >= docHeight - 2)) {
                if (selWidth >= docWidth - 2 && selHeight >= docHeight - 2) {
                    const fullDocRatioLabel = getDocAspectRatioLabel(docWidth, docHeight);
                    bestRatioName = `Full Doc ${fullDocRatioLabel ? ' ' + fullDocRatioLabel : ''}`;
                } else {
                    bestRatioName = "Padded";
                }
                // bestW/bestH remain at targetMinW/targetMinH; shift+clamp follows below
            } else {
                for (const ratio of aspectRatios) {
                    // a) Minimum bounding box at this ratio that still covers targetMinW × targetMinH
                    const candW = Math.max(targetMinW, targetMinH * ratio.value);
                    const candH = Math.max(targetMinH, targetMinW / ratio.value);

                    // b) Center on the selection
                    let simLeft = Math.round(centerX - (candW / 2));
                    let simTop = Math.round(centerY - (candH / 2));
                    let simRight = Math.round(centerX + (candW / 2));
                    let simBottom = Math.round(centerY + (candH / 2));

                    // c) Shift to keep within canvas boundaries
                    if (simLeft < 0) { simRight += Math.abs(simLeft); simLeft = 0; }
                    else if (simRight > docWidth) { simLeft -= (simRight - docWidth); simRight = docWidth; }
                    if (simTop < 0) { simBottom += Math.abs(simTop); simTop = 0; }
                    else if (simBottom > docHeight) { simTop -= (simBottom - docHeight); simBottom = docHeight; }

                    // d) Hard clamp to canvas bounds
                    simLeft = Math.max(0, simLeft);
                    simTop = Math.max(0, simTop);
                    simRight = Math.min(docWidth, simRight);
                    simBottom = Math.min(docHeight, simBottom);

                    const simW = simRight - simLeft;
                    const simH = simBottom - simTop;

                    // e) Enforce exact ratio by trimming the over-large side symmetrically from center
                    const simCenterX = (simLeft + simRight) / 2;
                    const simCenterY = (simTop + simBottom) / 2;
                    let finalW, finalH;
                    if (simW / simH > ratio.value) {
                        // Too wide after clamping — trim width to match ratio
                        finalH = simH;
                        finalW = Math.round(simH * ratio.value);
                    } else {
                        // Too tall or exact — trim height to match ratio
                        finalW = simW;
                        finalH = Math.round(simW / ratio.value);
                    }
                    const fLeft = Math.round(simCenterX - finalW / 2);
                    const fTop = Math.round(simCenterY - finalH / 2);
                    const fRight = fLeft + finalW;
                    const fBottom = fTop + finalH;

                    // f) Verify the original selection still fits inside the trimmed box
                    if (fLeft > selLeft || fRight < selRight ||
                        fTop > selTop || fBottom < selBottom) {
                        continue; // This ratio cannot contain the selection — skip
                    }

                    // g) Score: smaller area wins; weight is a tie-breaker penalty
                    const score = (finalW * finalH) * ratio.weight;
                    if (score < minScore) {
                        minScore = score;
                        bestW = finalW;
                        bestH = finalH;
                        bestRatioName = ratio.name;
                        finalCoords = { left: fLeft, top: fTop, right: fRight, bottom: fBottom };
                    }
                }
            }

            // 4. Build expandedBounds
            if (finalCoords) {
                // A valid ratio won: use pre-computed coordinates — dimensions are guaranteed to match the ratio
                expandedBounds = {
                    left: finalCoords.left,
                    top: finalCoords.top,
                    right: finalCoords.right,
                    bottom: finalCoords.bottom,
                    width: bestW,
                    height: bestH
                };
            } else {
                // Padded / Full Doc: center + shift + clamp with targetMinW × targetMinH (no ratio enforced)
                let newLeft = Math.round(centerX - (bestW / 2));
                let newTop = Math.round(centerY - (bestH / 2));
                let newRight = Math.round(centerX + (bestW / 2));
                let newBottom = Math.round(centerY + (bestH / 2));

                if (newLeft < 0) { newRight += Math.abs(newLeft); newLeft = 0; }
                else if (newRight > docWidth) { newLeft -= (newRight - docWidth); newRight = docWidth; }
                if (newTop < 0) { newBottom += Math.abs(newTop); newTop = 0; }
                else if (newBottom > docHeight) { newTop -= (newBottom - docHeight); newBottom = docHeight; }

                newLeft = Math.max(0, newLeft);
                newTop = Math.max(0, newTop);
                newRight = Math.min(docWidth, newRight);
                newBottom = Math.min(docHeight, newBottom);

                expandedBounds = {
                    left: newLeft,
                    top: newTop,
                    right: newRight,
                    bottom: newBottom,
                    width: newRight - newLeft,
                    height: newBottom - newTop
                };
            }

            console.log('Original Bounds:', bounds);
            console.log('Expanded Bounds (with padding):', expandedBounds);
        }

        // Get the selection mask
        // API often returns tight bounds even if we request expanded ones.
        // We must handle the potential size mismatch manually.
        const selectionResult = await imaging.getSelection({
            documentID: doc.id,
            sourceBounds: expandedBounds
        });

        // Resolve the actual returned bounds and data
        const returnedBounds = selectionResult.sourceBounds || expandedBounds;
        const psImageData = selectionResult.imageData;
        let finalMaskBuffer;

        // Get raw data from the returned image object
        const rawMaskData = await psImageData.getData();
        const tightMaskBuffer = new Uint8Array(rawMaskData);

        // Check if we need to manually pad
        // Compare logic: check if returned width/height matches requested dimensions
        const returnedWidth = returnedBounds.right - returnedBounds.left;
        const returnedHeight = returnedBounds.bottom - returnedBounds.top;

        // DOCUMENTATION: Manual Mask Padding Strategy
        // The imaging.getSelection API tends to "auto-crop" the result to the bounding box of the non-empty selection pixels,
        // ignoring the requested 'sourceBounds' if they contain empty (transparent/black) headers.
        // To strictly enforce the requested padding (context), we must:
        // 1. Detect if the returned image is smaller than requested.
        // 2. Create a new zero-filled buffer (black) of the full requested size.
        // 3. Composite the returned mask data into this buffer at the correct relative offset.

        if (returnedWidth < expandedBounds.width || returnedHeight < expandedBounds.height) {
            console.log(`[Padding Fix] Returned bounds (${returnedWidth}x${returnedHeight}) < Requested (${expandedBounds.width}x${expandedBounds.height}). Applying manual padding.`);

            // Create full-size black buffer (0 initialized)
            finalMaskBuffer = new Uint8Array(expandedBounds.width * expandedBounds.height);

            // Calculate offsets for placement
            const offsetX = returnedBounds.left - expandedBounds.left;
            const offsetY = returnedBounds.top - expandedBounds.top;

            // Copy tight mask into the full buffer
            for (let y = 0; y < returnedHeight; y++) {
                // Source row start
                const srcStart = y * returnedWidth;

                // Dest row start
                const dstRow = y + offsetY;
                const dstStart = (dstRow * expandedBounds.width) + offsetX;

                // Copy row with bounds validation
                if (dstRow >= 0 && dstRow < expandedBounds.height) {
                    // Safety: clamp width to prevent overflow
                    const copyLen = Math.min(returnedWidth, expandedBounds.width - offsetX);
                    if (copyLen > 0) {
                        const sub = tightMaskBuffer.subarray(srcStart, srcStart + copyLen);
                        finalMaskBuffer.set(sub, dstStart);
                    }
                }
            }
        } else {
            console.log('[Padding Fix] Bounds match requested. No manual padding needed.');
            finalMaskBuffer = tightMaskBuffer;
        }

        // Determine if the selection is a trivial "Select All" — the mask is entirely white
        // and carries no spatial information for the model.
        // NOTE: Bounds-based check alone is not sufficient: Full Doc mode also produces
        // expandedBounds equal to the document size but with a real mask (black background,
        // white selection area). Only a pixel-level check is reliable here.
        // Short-circuit: for non-Select-All masks the loop exits on the first dark pixel.
        const isSelectAll = finalMaskBuffer.every(v => v >= 250);
        if (isSelectAll) {
            console.log('[Capture] Select All detected — mask is trivially all-white, will suppress mask-related operations.');
        }

        // Create a compliant object for the payload
        // We use a plain object structure that fs.js can understand
        const maskData = {
            width: expandedBounds.width,
            height: expandedBounds.height,
            components: 1, // Grayscale
            imageData: finalMaskBuffer,
            sourceBounds: expandedBounds
        };

        // Get image content
        let imageData;

        if (viaTempDocCreation) {
            console.log("Using native PNG save method for capture...");
            imageData = await captureSelectionAsBase64PNG(sourceMode, expandedBounds, activeLayer, doc, psImageData, returnedBounds, executionContext);
        } else {
            console.log("Using traditional getPixels method for capture...");

            // Determine if the document requires 8-bit depth or sRGB profile conversion
            const isHighBitDepth = doc.bitsPerChannel === 16 ||
                                   doc.bitsPerChannel === 32 ||
                                   String(doc.bitsPerChannel).includes('16') ||
                                   String(doc.bitsPerChannel).includes('32');

            const profileName = (doc.colorProfileName || '').toLowerCase();
            const isWideGamutOrCustom = profileName.includes('prophoto') ||
                                        profileName.includes('adobe rgb') ||
                                        profileName.includes('display p3') ||
                                        profileName.includes('dci-p3') ||
                                        profileName.includes('wide gamut');

            const pixelOptions = {
                documentID: doc.id,
                sourceBounds: expandedBounds,
                components: 4,
                applyAlpha: true
            };

            if (isHighBitDepth) {
                console.log(`[Capture] High bit depth detected (${doc.bitsPerChannel}). Enforcing componentSize: 8.`);
                pixelOptions.componentSize = 8;
            }

            if (isWideGamutOrCustom) {
                console.log(`[Capture] Wide gamut profile detected (${doc.colorProfileName}). Enforcing sRGB conversion.`);
                pixelOptions.colorSpace = 'RGB';
                pixelOptions.colorProfile = 'sRGB IEC61966-2.1';
            }

            if (sourceMode === 'copyMerged') {
                // Get merged (composite) pixels
                imageData = await imaging.getPixels(pixelOptions);
            } else {
                // Get pixels from current layer only
                if (!activeLayer) {
                    throw new Error("No active layer");
                }
                imageData = await imaging.getPixels({
                    ...pixelOptions,
                    layerID: activeLayer.id
                });
            }
        }

        // Build context info
        const context = {
            documentId: doc.id,
            documentName: doc.name,
            resolution: doc.resolution,
            layerName: activeLayer ? activeLayer.name : null,
            layerId: activeLayer ? activeLayer.id : null,
            layerKind: activeLayer ? activeLayer.kind : null,
            originalBounds: bounds // Store original selection bounds just in case
        };

        return {
            imageData,
            maskData,
            bounds: expandedBounds, // Return the expanded bounds as the primary bounds
            aspectRatio: bestRatioName,
            isSelectAll, // true when Ctrl+A / Select All: mask is all-white, no spatial info
            context
        };
    }, { commandName: "Capture Selection" });
}

/**
 * Capture the current selection by saving it to a temporary PNG file.
 * 
 * WHY THIS FUNCTION EXISTS (PLAN B FOR TRANSPARENCY):
 * The standard `captureSelection` function uses the `imaging.getPixels` API.
 * However, in many versions of Photoshop UXP, `getPixels` (especially with 'copyMerged'
 * or when applying alpha) forcibly flattens/pre-multiplies transparent and semi-transparent
 * pixels with a white or background Matte Color. Furthermore, the `imaging.encodeImageData` 
 * API often crashes ("Cannot be encoded as jpeg") when fed raw 4-component (RGBA) data 
 * without `applyAlpha: true`.
 * 
 * To guarantee 100% preservation of the alpha channel exactly as it looks in Photoshop,
 * this alternative function:
 *      Capture selection by creating a temporary document of the EXACT expandedBounds size,
 *      pasting the copied pixels into it, saving it natively as a PNG (which perfectly preserves alpha),
 *      and returning it as a ready-to-use Base64 string.
 *
 * @param {string} sourceMode - 'copyMerged' or 'currentLayer'
 * @param {object} expandedBounds - Pre-calculated padded bounds
 * @param {object} activeLayer - The active layer (if any)
 * @param {object} doc - The active document
 * @param {object} originalSelectionMask - The PhotoshopImageData mask from imaging.getSelection
 * @param {object} originalSelectionBounds - The bounds where the mask should be placed
 * @returns {Promise<string>} Base64 data URL of the PNG
 */
async function captureSelectionAsBase64PNG(sourceMode, expandedBounds, activeLayer, doc, originalSelectionMask, originalSelectionBounds, executionContext) {
    const fs = require('uxp').storage.localFileSystem;

    const leaveWorkingDoc = false; //for testing features
    let doNotRestoreSelection = false;

    // 1. Perform the copy operation using native UXP DOM methods
    // Explicitly set the document selection to expandedBounds
    // to ensure the clipboard contains the full padded area.
    try {
        const copyTarget = activeLayer || (doc.activeLayers && doc.activeLayers[0]);
        if (!copyTarget) {
            throw new Error("No layer found to perform copy operation.");
        }

        // --- HISTORY SUSPENSION START ---
        // We use suspendHistory to group all "technical" manipulations (layer creation, drawing, selection)
        // into a single state, which we will then UNDO to leave the user's document history perfectly clean.
        const hostControl = executionContext.hostControl;
        const suspensionID = leaveWorkingDoc ? null : await hostControl.suspendHistory({
            documentID: doc.id,
            name: "Capture Merged Padding"
        });

        // 1. Set the selection FIRST (with sync steps)
        console.log(`[Capture] Resetting selection to expandedBounds:`, expandedBounds);
        await doc.selection.selectRectangle({
            top: Math.round(expandedBounds.top),
            left: Math.round(expandedBounds.left),
            bottom: Math.round(expandedBounds.bottom),
            right: Math.round(expandedBounds.right)
        }, constants.SelectionType.REPLACE);

        if (sourceMode === 'copyMerged') {
            console.log("[Capture] Applying technical pixels workaround for copyMerged...");
            // WORKAROUND: Photoshop trims transparent edges during copyMerged.
            // We draw pixels on a temporary layer. 
            // IMPORTANT: 'replace: false' is used so that each putPixels call adds to the layer.

            const tempLayer = await doc.createLayer({ name: "Technical Padding Layer" });

            const r = leaveWorkingDoc ? 191 : 0;
            const g = leaveWorkingDoc ? 255 : 0;
            const b = leaveWorkingDoc ? 0 : 0;
            const a = leaveWorkingDoc ? 255 : 1;

            // Helper to create and put a single pixel
            const putSinglePixel = async (x, y) => {
                const buffer = new Uint8Array([r, g, b, a]);
                const data = await imaging.createImageDataFromBuffer(buffer, {
                    width: 1, height: 1, components: 4, colorSpace: "RGB"
                });
                await imaging.putPixels({
                    layerID: tempLayer.id,
                    imageData: data,
                    replace: false, // Critical: don't clear the layer
                    targetBounds: { top: y, left: x }
                });
                data.dispose();
            };

            // 3. Place pixels at the corners and center
            await putSinglePixel(Math.round(expandedBounds.left), Math.round(expandedBounds.top));
            await putSinglePixel(Math.round(expandedBounds.right) - 1, Math.round(expandedBounds.bottom) - 1);
            if (leaveWorkingDoc) {
                const centerX = Math.round(expandedBounds.left + expandedBounds.width / 2);
                const centerY = Math.round(expandedBounds.top + expandedBounds.height / 2);
                await putSinglePixel(centerX, centerY);
            }

            // 5. Finally perform the copy merged
            await copyTarget.copy(true);
        } else {
            // Normal copy for currentLayer (via DOM)
            await copyTarget.copy();
        }

        // --- CLEANUP & HISTORY REVERSION ---
        // Finalize the history state. 
        // passing 'false' as the second argument rolls back all changes made during suspension.
        if (suspensionID) {
            console.log("[Capture] Reverting technical document changes (History Clean via Rollback)...");
            await hostControl.resumeHistory(suspensionID, false);
            doNotRestoreSelection = true;
        } else if (leaveWorkingDoc) {
            console.log("[Capture] DEBUG MODE: Selection and technical layers left untouched.");
        }

    } catch (copyErr) {
        console.error("Failed to copy selection via DOM:", copyErr);
        throw new Error(`Could not copy the selected area: ${copyErr.message}`);
    }

    // 2. Create a new document with the exact dimensions of our expandedBounds
    // (leaveWorkingDoc used here to control tempDoc cleanup as well)
    let tempDoc;
    try {
        tempDoc = await app.documents.add({
            width: Math.round(expandedBounds.width),
            height: Math.round(expandedBounds.height),
            resolution: doc.resolution,
            mode: "RGBColorMode",
            fill: "transparent"
        });

        console.log(`[Capture] Temp Document Created: ${tempDoc.width}x${tempDoc.height} (Target: ${expandedBounds.width}x${expandedBounds.height})`);

        if (Math.round(tempDoc.width) !== Math.round(expandedBounds.width) ||
            Math.round(tempDoc.height) !== Math.round(expandedBounds.height)) {
            console.error(`[Capture] CRITICAL: Photoshop ignored requested dimensions! Requested ${expandedBounds.width}x${expandedBounds.height}, Got ${tempDoc.width}x${tempDoc.height}`);
        }

        // 3. Paste the copied content into the exact center of this new doc
        await tempDoc.paste();

        // Ensure paste completes visually and merge visible layers to preserve transparency properly
        //await new Promise(r => setTimeout(r, 200));
        //await require('photoshop').action.batchPlay([{ _obj: "mergeVisible" }], { synchronousExecution: true });

    } catch (docErr) {
        if (tempDoc && !leaveWorkingDoc) await tempDoc.closeWithoutSaving();
        console.error("Failed to process clipboard document:", docErr);
        throw new Error("Failed to create temporary padded document.");
    }

    // 4. Save to temporary PNG file
    let fileBuffer;
    try {
        const tempFolder = await fs.getTemporaryFolder();
        const tempFileName = `capture_base64_${Date.now()}.png`;
        const fileEntry = await tempFolder.createFile(tempFileName, { overwrite: true });

        // Save natively as PNG
        console.log("Saving temp base64 PNG to:", fileEntry.nativePath);
        await tempDoc.saveAs.png(fileEntry, {
            compression: 9,
            interlaced: false
        }, true);

        // Read the binary file buffer
        fileBuffer = await fileEntry.read({ format: require("uxp").storage.formats.binary });

    } catch (saveErr) {
        console.error("Failed to save temporary PNG:", saveErr);
        throw saveErr;
    } finally {
        // Clean up the temporary document and restore active document
        if (tempDoc && !leaveWorkingDoc) {
            await tempDoc.closeWithoutSaving();
        }
        app.activeDocument = doc;

        // Restore the original selection using the mask data
        if (!doNotRestoreSelection && originalSelectionMask && !leaveWorkingDoc) {
            //actually it's never heppended 
            try {
                console.log("[Capture] Restoring original selection via imaging.putSelection...");
                await imaging.putSelection({
                    documentID: doc.id,
                    imageData: originalSelectionMask,
                    targetBounds: {
                        left: originalSelectionBounds.left,
                        top: originalSelectionBounds.top
                    },
                    replace: true
                });
            } catch (restoreErr) {
                console.warn("Failed to restore original selection:", restoreErr);
            }
        }
    }

    // 5. Convert ArrayBuffer to Base64 String
    const base64String = bufferToBase64(fileBuffer);
    return `data:image/png;base64,${base64String}`;
}

/**
 * Helper to convert ArrayBuffer to Base64 string in pure JS inside UXP
 */
function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    // UXP often requires global btoa
    if (typeof btoa !== 'undefined') return btoa(binary);
    if (typeof window !== 'undefined' && window.btoa) return window.btoa(binary);
    throw new Error("Base64 encoding not supported in this environment");
}

/**
 * Convert ImageData to a data URL for preview
 * @param {object} imageObj - Image object from imaging API
 * @returns {Promise<string>} Data URL
 */
async function imageDataToDataURL(imageObj) {
    const { imageData, width, height, components } = imageObj;

    // Create canvas-like buffer
    // UXP doesn't have canvas, so we need to encode manually
    // We'll convert to PNG format
    const base64 = await encodeToPNGBase64(imageData, width, height, components);
    return `data:image/png;base64,${base64}`;
}

/**
 * Encode raw pixel data to PNG base64
 * Simple implementation for preview purposes
 */
async function encodeToPNGBase64(pixelData, width, height, components) {
    // For UXP, we'll save to temp file and read back
    // This is a workaround since UXP lacks canvas
    const fs = require('./fs.js');
    return await fs.imageDataToBase64({ imageData: pixelData, width, height, components });
}

/**
 * Tuning for the mask edge softening (feathering) applied during place back.
 *
 * Softening the mask edge creates a smooth transition between the generated fragment
 * and the original image, making the seam invisible.
 */
const MASK_FEATHER = {
    // Enable or disable the entire edge-softening workflow.
    enabled: false,

    // Controls the shift of the transition relative to the original selection edge.
    //  1.0 = Push transition entirely outward (grows the mask). Keeps the selected area 100% replaced.
    //  0.0 = Center transition on the edge (half inward, half outward).
    // -1.0 = Pull transition entirely inward (shrinks the mask).
    bias: 1.0,

    // Starting feather radius calculated as a fraction of the shorter side of the captured image
    // (e.g., 0.015 is 1.5% of the shorter dimension).
    relative: 0.015,

    // Minimum feather radius in pixels. If the calculated radius is smaller than this,
    // softening is skipped to avoid useless micro-blurs.
    minRadius: 2,

    // Maximum cap for the feather radius in pixels, preventing excessive blur on large documents.
    maxRadius: 20,

    // Max fraction of the available padding (the space between the mask boundary and the capture edge)
    // that the transition can occupy. This prevents the blur from getting cut off at the edge of the layer.
    paddingShare: 0.4,

    // Max fraction of the selection's smallest dimension that can be eaten by the blur.
    // This prevents small selections from being completely blurred out.
    selectionShare: 0.25
};

/**
 * Find the bounding box of the visible part of a grayscale mask.
 * @returns {?object} {left, top, right, bottom} in buffer coordinates, or null if empty
 */
function measureMaskBox(buffer, width, height, threshold = 128) {
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;

    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            if (buffer[row + x] >= threshold) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }

    return right < 0 ? null : { left, top, right, bottom };
}

/**
 * Grayscale dilation (enlargement / expansion): Expands (thickens) the white areas of the mask outward by `radius` pixels.
 * (Note: This is "dilation" as in expanding/widening/enlargement)
 * 
 * Implemented efficiently using two separable sliding window maximum passes with a
 * monotonic queue, meaning execution time is constant O(1) relative to the radius.
 * 
 * @returns {Uint8Array} A new buffer; the input is left untouched.
 */
function dilateMask(buffer, width, height, radius) {
    const r = Math.max(1, Math.round(radius));
    const horizontal = new Uint8Array(width * height);
    const result = new Uint8Array(width * height);
    const queue = new Int32Array(Math.max(width, height));

    for (let y = 0; y < height; y++) {
        const row = y * width;
        let head = 0;
        let tail = 0;

        for (let x = 0; x < width + r; x++) {
            if (x < width) {
                const value = buffer[row + x];
                while (tail > head && buffer[row + queue[tail - 1]] <= value) tail--;
                queue[tail++] = x;
            }

            const target = x - r;
            if (target >= 0) {
                while (queue[head] < target - r) head++;
                horizontal[row + target] = buffer[row + queue[head]];
            }
        }
    }

    for (let x = 0; x < width; x++) {
        let head = 0;
        let tail = 0;

        for (let y = 0; y < height + r; y++) {
            if (y < height) {
                const value = horizontal[y * width + x];
                while (tail > head && horizontal[queue[tail - 1] * width + x] <= value) tail--;
                queue[tail++] = y;
            }

            const target = y - r;
            if (target >= 0) {
                while (queue[head] < target - r) head++;
                result[target * width + x] = horizontal[queue[head] * width + x];
            }
        }
    }

    return result;
}

/**
 * Grayscale erosion (shrinking / reduction): Shrinks (thins) the white areas of the mask inward by `radius` pixels.
 * (Note: This is "erosion" as in wearing away/shrinking/reduction)
 * 
 * Done by inverting the mask, dilating (expanding) it, and inverting back.
 * 
 * @returns {Uint8Array} A new buffer; the input is left untouched.
 */
function erodeMask(buffer, width, height, radius) {
    const inverted = new Uint8Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        inverted[i] = 255 - buffer[i];
    }

    const grown = dilateMask(inverted, width, height, radius);
    for (let i = 0; i < grown.length; i++) {
        grown[i] = 255 - grown[i];
    }

    return grown;
}

/**
 * Work out how far the mask edge may be softened.
 *
 * The transition spreads roughly +-radius around the edge, and pushing it fully outside
 * moves it another `radius` out, so it needs about twice the radius in free space. That
 * space is the ring between the selection and the border of the captured area. If the
 * transition ran past that border it would be cut off by the edge of the placed layer,
 * which shows up as a straight soft line - worse than the seam we are trying to hide.
 *
 * Sides on the document border do not drive `radius` (a clipped transition there is
 * invisible), but outward `offset` is still capped by the real gap on every side.
 * Otherwise a 5px strip of original next to the canvas is swallowed by a 15px expand.
 *
 * @param {Uint8Array} buffer - Grayscale mask
 * @param {object} freeSides - {left, top, right, bottom}: false for sides that sit on the
 *        document border, where a clipped transition is invisible anyway
 * @returns {object} {radius, offset} in pixels; radius 0 means no softening
 */
function resolveMaskFeather(buffer, width, height, freeSides, overrides = {}) {
    const config = Object.assign({}, MASK_FEATHER, overrides);
    const none = { radius: 0, offset: 0 };

    if (!config.enabled) {
        console.log('[Feather] Disabled (enabled=false), skipping mask softening.');
        return none;
    }

    if (config.skip) {
        console.log('[Feather] Select All detected \u2014 mask is trivially all-white, skipping feather.');
        return none;
    }

    const box = measureMaskBox(buffer, width, height);
    if (!box) {
        console.log('[Feather] Mask is empty, skipping.');
        return none;
    }

    const gapLeft = box.left;
    const gapTop = box.top;
    const gapRight = width - 1 - box.right;
    const gapBottom = height - 1 - box.bottom;
    const physical = Math.min(gapLeft, gapTop, gapRight, gapBottom);

    const visibleGaps = [];
    if (!freeSides || freeSides.left) visibleGaps.push(gapLeft);
    if (!freeSides || freeSides.top) visibleGaps.push(gapTop);
    if (!freeSides || freeSides.right) visibleGaps.push(gapRight);
    if (!freeSides || freeSides.bottom) visibleGaps.push(gapBottom);

    // All sides sit on the document border: a clipped transition cannot be seen
    const padding = visibleGaps.length > 0 ? Math.min(...visibleGaps) : Math.max(width, height);
    const selectionSide = Math.min(box.right - box.left + 1, box.bottom - box.top + 1);

    const radius = Math.floor(Math.min(
        config.relative * Math.min(width, height),
        config.maxRadius,
        padding * config.paddingShare,
        selectionSide * config.selectionShare
    ));

    if (radius < config.minRadius) {
        console.log(`[Feather] Not enough room (padding=${padding}px, selection=${selectionSide}px), skipping.`);
        return none;
    }

    let offset = Math.round(radius * config.bias);
    // Outward growth cannot exceed the real buffer gap on any side, including
    // document-aligned ones that were ignored when picking radius.
    if (offset > physical) {
        offset = physical;
    }

    console.log(`[Feather] radius=${radius}px, offset=${offset}px, padding=${padding}px, gap=${physical}px, selection=${selectionSide}px`);
    return { radius, offset };
}

/**
 * Prepares mask buffer, computes feather/offset, applies dilation/erosion if needed,
 * and creates a grayscale PhotoshopImageData instance.
 * @param {object} doc - Active Photoshop document
 * @param {object} bounds - Capture bounds {left, top, width, height}
 * @param {object} maskImageData - Mask ImageData (or buffer container)
 * @param {object} [featherOptions={}] - Feather configuration overrides
 * @returns {Promise<{psImageData: PhotoshopImageData, feather: {radius: number, offset: number}, maskWidth: number, maskHeight: number, maskBuffer: Uint8Array}>}
 */
async function prepareMaskBufferAndImageData(doc, bounds, maskImageData, featherOptions = {}) {
    let maskBuffer, maskWidth, maskHeight;

    if (maskImageData.imageData instanceof Uint8Array) {
        // Direct buffer from capture
        maskBuffer = maskImageData.imageData;
        maskWidth = maskImageData.width;
        maskHeight = maskImageData.height;
    } else if (maskImageData.getData) {
        // PhotoshopImageData object
        maskBuffer = new Uint8Array(await maskImageData.getData());
        maskWidth = maskImageData.width;
        maskHeight = maskImageData.height;
    } else {
        throw new Error("Invalid mask data format");
    }

    console.log(`Mask dimensions: ${maskWidth}x${maskHeight}, buffer size: ${maskBuffer.length}`);

    // Soften the mask edge so the generated fragment does not meet the original
    // image along a hard step. A capture side on the document border does not
    // drive the feather radius (clipping there is invisible), but growth is
    // still capped by the real gap so a near-edge strip is not swallowed.
    const freeSides = {
        left: bounds.left > 0,
        top: bounds.top > 0,
        right: bounds.left + maskWidth < doc.width,
        bottom: bounds.top + maskHeight < doc.height
    };
    const feather = resolveMaskFeather(maskBuffer, maskWidth, maskHeight, freeSides, featherOptions);

    if (feather.offset !== 0) {
        // Move the edge before feathering, so the transition ends up where the
        // bias asks for it. Positive offset grows the mask (transition lands in
        // the padding ring instead of eating into the area the user asked to
        // replace), negative shrinks it. Both return a new buffer, leaving the
        // cached capture intact.
        maskBuffer = feather.offset > 0
            ? dilateMask(maskBuffer, maskWidth, maskHeight, feather.offset)
            : erodeMask(maskBuffer, maskWidth, maskHeight, -feather.offset);
    }

    // Create proper PhotoshopImageData for the mask (grayscale)
    const psImageData = await imaging.createImageDataFromBuffer(maskBuffer, {
        width: maskWidth,
        height: maskHeight,
        components: 1,  // Masks are grayscale
        chunky: false,
        colorProfile: "Gray Gamma 2.2",
        colorSpace: "Grayscale"
    });

    return { psImageData, feather, maskWidth, maskHeight, maskBuffer };
}

/**
 * Applies a layer mask to the specified layer and sets its feather property.
 * @param {object} doc - Active Photoshop document
 * @param {object} layer - Target layer
 * @param {PhotoshopImageData} psImageData - Prepared mask image data
 * @param {object} bounds - Original capture bounds
 * @param {number} maskWidth - Mask width in pixels
 * @param {number} maskHeight - Mask height in pixels
 * @param {number} [featherRadius=0] - Mask feather radius in pixels
 */
async function applyLayerMaskToLayer(doc, layer, psImageData, bounds, maskWidth, maskHeight, featherRadius = 0) {
    // First create an empty mask (reveal all / hide all)
    await action.batchPlay([
        {
            _obj: "make",
            at: { _ref: "channel", _enum: "channel", _value: "mask" },
            new: { _class: "channel" },
            using: { _enum: "userMaskEnabled", _value: "hideAll" }
        }
    ], { synchronousExecution: true });

    // Put the mask data with correct target bounds
    await imaging.putLayerMask({
        documentID: doc.id,
        layerID: layer.id,
        imageData: psImageData,
        targetBounds: {
            left: bounds.left,
            top: bounds.top,
            right: bounds.left + maskWidth,
            bottom: bounds.top + maskHeight
        }
    });

    if (featherRadius > 0) {
        // Photoshop's own mask feather: it stays live, so the user can still
        // drag the Feather slider in Properties without redoing the place back.
        try {
            layer.layerMaskFeather = featherRadius;
        } catch (featherError) {
            console.warn("Could not set layer mask feather:", featherError);
        }
    }
}

/**
 * Restores selection in the document based on maskImageData and featherOptions without modifying layers.
 * @param {object} doc - Active Photoshop document
 * @param {object} bounds - Original capture bounds {left, top, width, height}
 * @param {object} [maskImageData] - Mask ImageData or buffer
 * @param {object} [featherOptions={}] - Feather configuration overrides
 */
async function restoreSelection(doc, bounds, maskImageData, featherOptions = {}) {
    console.log("Restoring selection from mask data...");

    if (maskImageData) {
        const { psImageData, feather } = await prepareMaskBufferAndImageData(doc, bounds, maskImageData, featherOptions);

        await imaging.putSelection({
            documentID: doc.id,
            imageData: psImageData,
            replace: true,
            targetBounds: {
                left: bounds.left,
                top: bounds.top
            }
        });

        if (feather.radius > 0) {
            console.log(`Applying native selection feather: ${feather.radius}px...`);
            try {
                await action.batchPlay([
                    {
                        _obj: "feather",
                        radius: {
                            _unit: "pixelsUnit",
                            _value: feather.radius
                        },
                        applyEffectAtCanvasBounds: false,
                        _options: {
                            dialogOptions: "dontDisplay"
                        }
                    }
                ], { synchronousExecution: true });
            } catch (featherError) {
                console.warn("Native selection feather failed:", featherError);
            }
        }
    } else if (bounds) {
        // Fallback: restore rectangular selection matching bounds
        console.log("No mask data provided, restoring rectangular selection from bounds:", bounds);
        await action.batchPlay([
            {
                _obj: "set",
                _target: [{ _ref: "channel", _enum: "channel", _value: "selection" }],
                to: {
                    _obj: "rectangle",
                    top: { _unit: "pixelsUnit", _value: bounds.top },
                    left: { _unit: "pixelsUnit", _value: bounds.left },
                    bottom: { _unit: "pixelsUnit", _value: bounds.bottom !== undefined ? bounds.bottom : (bounds.top + bounds.height) },
                    right: { _unit: "pixelsUnit", _value: bounds.right !== undefined ? bounds.right : (bounds.left + bounds.width) }
                }
            }
        ], { synchronousExecution: true });
    }
}

/**
 * Place result image back into Photoshop or restore selection
 * Creates Smart Object with optional layer mask and feathering, or restores selection
 * @param {'so'|'editableSo'|'mask'|'selection'} placeBackMode - Placement mode ('so' for fast standard placement, 'editableSo' for editable Smart Object, 'mask' for editable Smart Object with native document mask, 'selection' to restore selection only)
 * @param {string} fileToken - Session token for result file
 * @param {object} bounds - Original capture bounds {left, top, width, height}
 * @param {object} [maskImageData] - The mask ImageData (or null if no mask)
 * @param {object} [featherOptions={}] - Overrides for the mask edge softening; see MASK_FEATHER
 *        for the defaults and the meaning of each field. Pass `{ enabled: false }` to place
 *        the mask with a hard edge, as it was before this option existed.
 */
async function placeBack(placeBackMode, fileToken, bounds, maskImageData, featherOptions = {}) {
    const doc = app.activeDocument;

    const isSelectionOnly = placeBackMode === 'selection';
    const applyPlaceBackAsMask = placeBackMode === 'mask';
    const CREATE_EDITABLE_SMART_OBJECTS = applyPlaceBackAsMask || placeBackMode === 'editableSo';

    await core.executeAsModal(async (executionContext) => {
        const hostControl = executionContext.hostControl;
        const documentID = doc.id;

        // Suspend history for single undo
        const suspensionID = await hostControl.suspendHistory({
            documentID: documentID,
            name: isSelectionOnly ? "Restore Selection FromPS" : "Place Back FromPS/ToPS"
        });

        console.log(`Starting Place Back operation (mode: ${placeBackMode})...`);
        console.log("File Token:", fileToken ? "Present" : "Missing");
        console.log("Bounds:", JSON.stringify(bounds));
        console.log("Mask Data:", maskImageData ? "Present" : "Missing");
        const effectiveFeatherConfig = Object.assign({}, MASK_FEATHER, featherOptions);
        console.log("Feather Config:", JSON.stringify(effectiveFeatherConfig));

        // Local adaptation: roll back partially inserted layers when mask/placement fails.
        let commitHistory = true;
        try {
            if (isSelectionOnly) {
                await restoreSelection(doc, bounds, maskImageData, featherOptions);
                return;
            }

            // Step 1 to 3: Placement & Transformation
            let placedImageWidth = 0;
            let placedImageHeight = 0;

            if (CREATE_EDITABLE_SMART_OBJECTS) {
                // NEW PATH: High-Res Editable Smart Object via Temp Document 
                // useful when pasted image is larger than the document. 
                // it prevents automatic resizing of pasted image
                console.log("Using High-Res Editable Smart Object path...");
                const result = await placeAsEditableSmartObject(fileToken, bounds, doc);
                placedImageWidth = result.placedImageWidth;
                placedImageHeight = result.placedImageHeight;
            } else {
                // ORIGINAL PATH: Standard Place (may scale down, but honors false flag)
                console.log("Using original placement path...");

                // Step 1: Place the image as new layer
                try {
                    console.log("Step 1: Placing image...");
                    await action.batchPlay([
                        {
                            _obj: "placeEvent",
                            null: {
                                _path: fileToken,
                                _kind: "local"
                            },
                            freeTransformCenterState: {
                                _enum: "quadCenterState",
                                _value: "QCSAverage"
                            },
                            offset: {
                                _obj: "offset",
                                horizontal: { _unit: "pixelsUnit", _value: 0 },
                                vertical: { _unit: "pixelsUnit", _value: 0 }
                            }
                        }
                    ], { synchronousExecution: true });
                } catch (placeError) {
                    console.error("Step 1 Failed (Place):", placeError);
                    throw new Error(`Failed to place image: ${placeError.message}`);
                }

                const placedLayer = doc.activeLayers[0];
                if (!placedLayer) {
                    throw new Error("Placement finished but no active layer found.");
                }

                // Step 1.5: Rasterize (Dead code technically if CREATE_EDITABLE_SMART_OBJECTS is false, but kept as requested)
                try {
                    if (CREATE_EDITABLE_SMART_OBJECTS) {
                        console.log("Step 1.5: Rasterizing placed layer to enable editable Smart Object...");
                        await action.batchPlay([
                            {
                                _obj: "rasterizeLayer",
                                _target: [
                                    { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
                                ]
                            }
                        ], { synchronousExecution: true });
                    }
                } catch (rasterizeError) {
                    console.warn("Step 1.5 Warning (Rasterization failed):", rasterizeError);
                }

                // Step 2: Ensure it is a Smart Object
                try {
                    const activeLayer = doc.activeLayers[0];
                    if (activeLayer.kind !== "smartObject") {
                        console.log("Step 2: Converting to Smart Object...");
                        await action.batchPlay([
                            {
                                _obj: "newPlacedLayer"
                            }
                        ], { synchronousExecution: true });
                    } else {
                        console.log("Step 2: Already a Smart Object.");
                    }
                } catch (e) {
                    console.warn("Step 2 Warning (Smart Object verification):", e);
                }

                // Step 3: Resize and position
                try {
                    console.log("Step 3: Transforming Smart Object...");
                    const placedLayer = doc.activeLayers[0];
                    const dimensions = await transformLayerToBounds(placedLayer, bounds);

                    placedImageWidth = dimensions.width;
                    placedImageHeight = dimensions.height;
                } catch (transformError) {
                    console.error("Step 3 Failed (Transform):", transformError);
                    throw new Error(`Failed to transform image: ${transformError.message}`);
                }
            }

            if (applyPlaceBackAsMask) {
                try {
                    await applySmartObjectNativeMask(doc);
                } catch (nativeMaskError) {
                    console.error("Native Masking Workflow failed:", nativeMaskError);
                    throw new Error(`Failed to apply native mask: ${nativeMaskError.message}`);
                }
            }

            // Step 4: Apply layer mask from captured mask
            if (maskImageData && !applyPlaceBackAsMask) {
                try {
                    console.log("Step 4: Applying mask...");
                    const maskPrep = await prepareMaskBufferAndImageData(doc, bounds, maskImageData, featherOptions);
                    const updatedLayer = doc.activeLayers[0];
                    await applyLayerMaskToLayer(doc, updatedLayer, maskPrep.psImageData, bounds, maskPrep.maskWidth, maskPrep.maskHeight, maskPrep.feather.radius);
                } catch (maskError) {
                    console.error("Step 4 Failed (Mask):", maskError);
                    throw new Error(`Failed to apply mask: ${maskError.message}`);
                }
            }

            // Step 5: Apply Gaussian Blur as Smart Filter to the Object (RGB)
            if (!applyPlaceBackAsMask && !featherOptions.skipImageBlur) {
                try {
                    console.log("Step 5: Applying Smart Filter (Gaussian Blur)...");

                    // Ensure RGB channel is selected (target the layer content)
                    await action.batchPlay([
                        {
                            _obj: "select",
                            _target: [
                                { _ref: "channel", _enum: "channel", _value: "RGB" }
                            ],
                            makeVisible: false
                        }
                    ], { synchronousExecution: true });

                    // Apply Gaussian Blur - on Smart Object this becomes a Smart Filter.
                    // Radius is calculated dynamically based on how much the image was scaled down:
                    //   scaleFactor = average of (placedWidth / maskWidth) and (placedHeight / maskHeight)
                    //   OLD: blurRadius = 0.2 + 2.0 * log2(scaleFactor), capped at 12px
                    //   NEW: blurRadius = 0.1 + 0.5 * log2(scaleFactor), capped at 1.1px, rounded to 0.1
                    const scaleW = placedImageWidth > 0 ? placedImageWidth / bounds.width : 1;
                    const scaleH = placedImageHeight > 0 ? placedImageHeight / bounds.height : 1;
                    const scaleFactor = (scaleW + scaleH) / 2;

                    // Old formula:
                    // const blurRadius = Math.min(12.0, 0.2 + 2.0 * Math.log2(Math.max(1, scaleFactor)));

                    // New formula (0.1 - 1.1 range, rounded to 0.1):
                    const rawBlurRadius = 0.1 + 0.5 * Math.log2(Math.max(1, scaleFactor));
                    const blurRadius = Math.round(Math.min(1.1, rawBlurRadius) * 10) / 10;
                    console.log(`Blur radius: ${blurRadius.toFixed(2)}px (scaleW=${scaleW.toFixed(2)}, scaleH=${scaleH.toFixed(2)}, factor=${scaleFactor.toFixed(2)})`);

                    await action.batchPlay([
                        {
                            _obj: "gaussianBlur",
                            radius: { _unit: "pixelsUnit", _value: blurRadius }
                        }
                    ], { synchronousExecution: true });

                    console.log("Gaussian Blur (Smart Filter) applied.");

                } catch (blurError) {
                    console.warn("Step 5 Failed (Smart Filter):", blurError);
                }
            }

        } catch (fatalError) {
            commitHistory = false;
            console.error("PlaceBack Fatal Error:", fatalError);
            throw fatalError;
        } finally {
            // Resume history
            await hostControl.resumeHistory(suspensionID, commitHistory);
        }

    }, { commandName: isSelectionOnly ? "Restore Selection FromPS" : "Place Back FromPS/ToPS" });
}

/**
 * Places an image into a temporary large document to prevent downscaling,
 * rasterizes it at 100% resolution, converts it to a Smart Object,
 * and duplicates it back to the target document.
 * 
 * @param {string} fileToken - File path or token for the image
 * @param {object} bounds - Target bounds in the destination document
 * @param {object} targetDoc - The destination Photoshop document object
 * @returns {Promise<{placedImageWidth: number, placedImageHeight: number}>}
 */
async function placeAsEditableSmartObject(fileToken, bounds, targetDoc) {
    const { app, core, action } = require("photoshop");

    console.log("Creating temporary document for high-res Smart Object placement...");
    let tempDoc = null;

    try {
        // Create an 8000x8000 temporary document
        tempDoc = await app.documents.add({
            width: 8000,
            height: 8000,
            resolution: 72,
            mode: "RGBColorMode",
            fill: "transparent"
        });

        // Step 1: Place Event (will be 100% scale because canvas is huge)
        await action.batchPlay([
            {
                _obj: "placeEvent",
                null: {
                    _path: fileToken,
                    _kind: "local"
                }
            }
        ], { synchronousExecution: true });

        // Step 2: Rasterize (Bakes at 100% resolution)
        await action.batchPlay([
            {
                _obj: "rasterizeLayer",
                _target: [
                    { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
                ]
            }
        ], { synchronousExecution: true });

        // Step 3: Convert to Smart Object
        await action.batchPlay([
            {
                _obj: "newPlacedLayer"
            }
        ], { synchronousExecution: true });

        // Step 4: Duplicate the Smart Object to the original document
        // CRITICAL BUG FIX: If the target document has an active selection, Photoshop will
        // automatically try to center the duplicated layer on that selection, throwing off
        // our absolute coordinate calculations later. We must deselect in the target document first.

        targetDoc.activeLayers = []; // Safety clear
        try {
            // Activate the target document briefly to clear its selection
            app.activeDocument = targetDoc;
            if (targetDoc.selection) {
                await targetDoc.selection.deselect();
            }
            // Switch back to temp document for the duplicate operation
            app.activeDocument = tempDoc;

            console.log("Cleared selection in target document to prevent duplicate auto-centering.");
        } catch (e) {
            // No selection existed, or failed. Ignore.
            console.log("No selection to clear, or error clearing:", e);
        }

        const smartObjectLayer = tempDoc.activeLayers[0];
        const duplicatedLayer = await smartObjectLayer.duplicate(targetDoc);

        // Step 5: Close temp doc without saving
        await tempDoc.closeWithoutSaving();
        tempDoc = null; // Mark as closed

        // Step 6: Select the duplicated layer in the target document
        app.activeDocument = targetDoc;
        targetDoc.activeLayers = [duplicatedLayer];

        // Step 7: Calculate Transformation bounds
        const dimensions = await transformLayerToBounds(duplicatedLayer, bounds);

        return {
            placedImageWidth: dimensions.width,
            placedImageHeight: dimensions.height
        };

    } catch (error) {
        console.error("Error in placeAsEditableSmartObject:", error);

        // Cleanup temp doc on error
        if (tempDoc) {
            try {
                await tempDoc.closeWithoutSaving();
            } catch (closeErr) {
                console.warn("Failed to clean up temp document:", closeErr);
            }
        }

        throw error;
    }
}

/**
 * Performs the Smart Object Native Masking Workflow:
 * 1. Renames the active Smart Object layer to "[ai mask] {originalName}".
 * 2. Opens the active Smart Object.
 * 3. Loads selection from the RGB channel.
 * 4. Creates a new Layer Mask inside from the selection.
 * 5. Saves the Smart Object.
 * 6. Closes the Smart Object.
 */
async function applySmartObjectNativeMask(parentDoc) {
    const { app, action } = require("photoshop");

    // Step 1: Rename the Smart Object layer to prefix it with [ai mask]
    console.log("Step 1: Renaming Smart Object layer...");
    const smartObjectLayer = parentDoc.activeLayers[0];
    if (smartObjectLayer) {
        const originalName = smartObjectLayer.name;
        if (!originalName.startsWith("[ai mask]")) {
            console.log(`Renaming Smart Object layer from "${originalName}" to "[ai mask] ${originalName}"`);
            smartObjectLayer.name = `[ai mask] ${originalName}`;
        }
    }

    console.log("Step 2: Editing Smart Object contents...");
    await action.batchPlay([
        {
            _obj: "placedLayerEditContents",
            _options: {
                dialogOptions: "dontDisplay"
            }
        }
    ], { synchronousExecution: true });

    const smartObjDoc = app.activeDocument;
    if (!smartObjDoc || smartObjDoc.id === parentDoc.id) {
        throw new Error("Failed to open Smart Object contents or active document did not change.");
    }

    console.log(`Opened Smart Object: ${smartObjDoc.name} (ID: ${smartObjDoc.id})`);

    try {
        // Step 3: Load selection from the RGB channel to select the white shape and ignore the black background.
        console.log("Step 3: Loading selection from RGB channel...");
        await action.batchPlay([
            {
                _obj: "set",
                _target: [
                    {
                        _ref: "channel",
                        _property: "selection"
                    }
                ],
                to: {
                    _ref: "channel",
                    _enum: "channel",
                    _value: "RGB"
                }
            }
        ], { synchronousExecution: true });

        // Step 4: Create a new Layer Mask from the active selection to make the black background transparent.
        console.log("Step 4: Creating Layer Mask from selection...");
        await action.batchPlay([
            {
                _obj: "make",
                at: { _ref: "channel", _enum: "channel", _value: "mask" },
                new: { _class: "channel" },
                using: {
                    _enum: "userMaskEnabled",
                    _value: "revealSelection"
                }
            }
        ], { synchronousExecution: true });

        // Step 5: Save contents of smart object.
        console.log("Step 5: Saving Smart Object contents...");
        await action.batchPlay([
            {
                _obj: "save",
                _options: {
                    dialogOptions: "dontDisplay"
                }
            }
        ], { synchronousExecution: true });

    } catch (error) {
        console.error("Error inside applySmartObjectNativeMask:", error);
        throw error;
    } finally {
        // Step 6: Close contents of smart object (Editing).
        console.log("Step 6: Closing Smart Object document...");
        try {
            await smartObjDoc.closeWithoutSaving();
        } catch (closeError) {
            console.warn("Error closing Smart Object document:", closeError);
        }

        // Restore focus to parent document just in case
        app.activeDocument = parentDoc;
    }

    // Step 7: Hide the Smart Object layer. It stays in the layer stack (for the inpaint mask
    // to be picked up), but shouldn't be visible/rendered until the user turns it on manually.
    console.log("Step 7: Hiding Smart Object layer...");
    if (smartObjectLayer) {
        smartObjectLayer.visible = false;
    }
}

/**
 * Helper function to scale and move a layer to exactly match target bounds
 * @param {object} layer - The layer to transform
 * @param {object} bounds - The target bounds {left, top, width, height}
 * @returns {Promise<{width: number, height: number}>} Original native dimensions of the layer before transform
 */
async function transformLayerToBounds(layer, bounds) {
    const { action } = require("photoshop");

    const layerBounds = layer.bounds;
    const currentWidth = layerBounds.right - layerBounds.left;
    const currentHeight = layerBounds.bottom - layerBounds.top;

    console.log(`Layer native bounds: w=${currentWidth}, h=${currentHeight}`);
    console.log(`Target bounds: w=${bounds.width}, h=${bounds.height}`);

    const safeWidth = currentWidth || 1;
    const safeHeight = currentHeight || 1;
    const scaleX = (bounds.width / safeWidth) * 100;
    const scaleY = (bounds.height / safeHeight) * 100;

    // Step 1: Scale
    await action.batchPlay([
        {
            _obj: "transform",
            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
            freeTransformCenterState: {
                _enum: "quadCenterState",
                _value: "QCSCorner0"
            },
            width: { _unit: "percentUnit", _value: scaleX },
            height: { _unit: "percentUnit", _value: scaleY },
            interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubic" }
        }
    ], { synchronousExecution: true });

    console.log(`Scaled to ${scaleX.toFixed(1)}% x ${scaleY.toFixed(1)}%`);

    // Step 2: Move
    const scaledBounds = layer.bounds;
    const deltaX = bounds.left - scaledBounds.left;
    const deltaY = bounds.top - scaledBounds.top;

    console.log(`Moving by: deltaX=${deltaX}, deltaY=${deltaY}`);

    if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
        await action.batchPlay([
            {
                _obj: "move",
                _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                to: {
                    _obj: "offset",
                    horizontal: { _unit: "pixelsUnit", _value: deltaX },
                    vertical: { _unit: "pixelsUnit", _value: deltaY }
                }
            }
        ], { synchronousExecution: true });
    }

    return {
        width: currentWidth,
        height: currentHeight
    };
}

/**
 * Get active layer info
 * @returns {object|null}
 */
function getActiveLayerInfo() {
    if (!hasActiveDocument()) return null;

    const layer = app.activeDocument.activeLayers[0];
    if (!layer) return null;

    return {
        name: layer.name,
        id: layer.id,
        kind: layer.kind.toString()
    };
}

module.exports = {
    hasActiveDocument,
    hasActiveSelection,
    getSelectionBounds,
    captureSelection,
    imageDataToDataURL,
    placeBack,
    getActiveLayerInfo,
    MASK_FEATHER
};
