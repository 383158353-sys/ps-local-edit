/**
 * Photoshop Helper Service Module
 * Communicates with PhotoshopHelper Electron app for clipboard and drag & drop functionality
 */

// Configuration
const HELPER_URL = 'http://localhost:18345';
const HELPER_VERSION = '1.0.0';

// Name of the file PhotoshopHelper writes into this plugin's private UXP data folder.
const PAIRING_FILENAME = 'photoshop-helper.json';

// Key used when the token has to be entered by hand from the plugin settings dialog.
const TOKEN_STORAGE_KEY = 'helper-pairing-token';

/**
 * Read the shared secret needed by the Helper's plugin-only endpoints.
 *
 * PhotoshopHelper writes the token into this plugin's private data folder, which UXP
 * lets us read without a file picker, so pairing normally needs no user action. A value
 * entered manually in the settings dialog wins, because it is the recovery path when the
 * automatic delivery cannot find this installation.
 *
 * @returns {Promise<string|null>} The token, or null when the plugin is not paired.
 */
async function getHelperToken() {
    try {
        const manualToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
        if (manualToken) {
            return manualToken;
        }
    } catch (error) {
        // localStorage being unavailable just means there is no manual override.
    }

    try {
        const localFileSystem = require('uxp').storage.localFileSystem;
        const dataFolder = await localFileSystem.getDataFolder();
        const pairingFile = await dataFolder.getEntry(PAIRING_FILENAME);
        const parsed = JSON.parse(await pairingFile.read());

        if (parsed && parsed.token) {
            return parsed.token;
        }
    } catch (error) {
        // getEntry throws when the Helper has not paired this installation yet.
    }

    return null;
}

/**
 * Store a token supplied by the user and use it for subsequent requests.
 *
 * @param {string} token - Token copied from the PhotoshopHelper tray menu.
 */
function setManualToken(token) {
    const trimmed = (token || '').trim();

    try {
        if (trimmed) {
            window.localStorage.setItem(TOKEN_STORAGE_KEY, trimmed);
        } else {
            window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
    } catch (error) {
        console.error('Failed to persist the Helper token:', error);
    }
}

/**
 * Read the token currently entered by hand, if any.
 *
 * @returns {string} The stored manual token, or an empty string.
 */
function getManualToken() {
    try {
        return window.localStorage.getItem(TOKEN_STORAGE_KEY) || '';
    } catch (error) {
        return '';
    }
}

/**
 * Build request headers carrying the pairing token.
 *
 * @param {object} [extraHeaders] - Headers to merge in.
 * @returns {Promise<object>} Headers for a fetch call.
 */
async function buildHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    const token = await getHelperToken();

    if (token) {
        headers['X-API-Key'] = token;
    }

    return headers;
}

/**
 * Translate a rejected response into the error shape used across this module.
 *
 * @param {Response} response - The failed response.
 * @param {object} [result] - Parsed response body, when available.
 * @returns {{success: boolean, error: string}} Normalized failure.
 */
function toErrorResult(response, result) {
    // 401 means the Helper is running but does not accept this plugin's credentials;
    // 503 means it has not finished initializing them. Both are pairing problems, and
    // reporting them as such stops the user hunting for a Helper that is already running.
    if (response.status === 401 || response.status === 503) {
        return {
            success: false,
            code: 'HELPER_NOT_PAIRED',
            error: 'HELPER_NOT_PAIRED'
        };
    }

    return {
        success: false,
        code: (result && result.code) || null,
        error: (result && result.error) || `HTTP ${response.status}`
    };
}

/**
 * Translate a thrown fetch error into the error shape used across this module.
 *
 * @param {Error} error - The caught error.
 * @returns {{success: boolean, error: string}} Normalized failure.
 */
function toThrownResult(error) {
    // Connection error - Helper not running
    if (error.name === 'TypeError' || error.message.includes('fetch') || error.message.includes('network')) {
        return {
            success: false,
            code: 'HELPER_NOT_RUNNING',
            error: 'HELPER_NOT_RUNNING'
        };
    }

    return {
        success: false,
        code: null,
        error: error.message
    };
}

/**
 * Check if PhotoshopHelper is running
 * @returns {Promise<boolean>}
 */
async function isHelperRunning() {

    // return {
    //     status: 'running',
    //     alerts: {
    //         photoshopPlugin: "Plugin version mismatch. Please right-click the PhotoshopHelper icon in the system tray, select 'Settings', and reinstall the plugin.",
    //         photoshopHelper: "PhotoshopHelper update is ready. Please right-click its icon in the system tray and select 'Update Ready, Restart' to apply."
    //     },
    //     version: "1.0.0"
    // };

    const { versions } = require("uxp");
    try {
        const pluginVersion = versions.plugin || 'unknown';
        const response = await fetch(`${HELPER_URL}/api/status?pluginVersion=${encodeURIComponent(pluginVersion)}`, {
            method: 'GET'
        });

        if (response.ok) {
            const data = await response.json();
            return data;
        }
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Report whether this plugin currently holds a Helper token.
 *
 * @returns {Promise<boolean>} True when a token is available.
 */
async function isPaired() {
    return (await getHelperToken()) !== null;
}

/**
 * Copy image to clipboard via PhotoshopHelper
 * @param {string} base64Png - Base64 encoded PNG data (without data URL prefix)
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function copyToClipboard(base64Png) {
    try {
        const response = await fetch(`${HELPER_URL}/api/clipboard/copy`, {
            method: 'POST',
            headers: await buildHeaders({
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify({
                image: `data:image/png;base64,${base64Png}`
            })
        });

        const result = await response.json();

        if (!response.ok) {
            return toErrorResult(response, result);
        }

        return result;

    } catch (error) {
        return toThrownResult(error);
    }
}

/**
 * Start drag & drop operation via PhotoshopHelper
 * @param {string|string[]} base64Images - Single base64 PNG or array of base64 PNGs (without data URL prefix)
 * @returns {Promise<{success: boolean, message?: string, error?: string, count?: number}>}
 */
async function startDrag(base64Images) {
    try {
        // Normalize to array
        const imagesArray = Array.isArray(base64Images) ? base64Images : [base64Images];

        // Add data URL prefix to each image
        const images = imagesArray.map(b64 => `data:image/png;base64,${b64}`);

        const response = await fetch(`${HELPER_URL}/api/drag/start`, {
            method: 'POST',
            headers: await buildHeaders({
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify({ images })
        });

        const result = await response.json();

        if (!response.ok) {
            return toErrorResult(response, result);
        }

        return result;

    } catch (error) {
        return toThrownResult(error);
    }
}

/**
 * Read image from clipboard via PhotoshopHelper
 * @returns {Promise<{success: boolean, image?: string, error?: string}>}
 */
async function readClipboard() {
    try {
        const response = await fetch(`${HELPER_URL}/api/clipboard/paste`, {
            method: 'GET',
            headers: await buildHeaders()
        });

        const result = await response.json();

        if (!response.ok) {
            return toErrorResult(response, result);
        }

        return result;

    } catch (error) {
        return toThrownResult(error);
    }
}



/**
 * Save file via PhotoshopHelper (auto-renames if exists)
 * @param {string} fullPath - Full path to save to
 * @param {string} base64Data - Base64 data (with or without prefix)
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function saveViaHelper(fullPath, base64Data) {
    try {
        const response = await fetch(`${HELPER_URL}/api/file/save`, {
            method: 'POST',
            headers: await buildHeaders({
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify({
                path: fullPath,
                data: base64Data
            })
        });

        const result = await response.json();

        if (!response.ok) {
            return toErrorResult(response, result);
        }

        return result;

    } catch (error) {
        return toThrownResult(error);
    }
}

/**
 * Send image and mask to WebHelper via PhotoshopHelper
 * @param {string} base64Image - Base64 encoded PNG data (with data URL prefix)
 * @param {string} base64Mask - Base64 encoded PNG data (with data URL prefix)
 * @returns {Promise<{success: boolean, message?: string, taskId?: string, error?: string}>}
 */
async function sendToWebHelper(base64Image, base64Mask) {
    try {
        const payload = { image: base64Image };
        if (base64Mask) {
            payload.mask = base64Mask;
        }

        const response = await fetch(`${HELPER_URL}/api/webhelper/task`, {
            method: 'POST',
            headers: await buildHeaders({
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            return toErrorResult(response, result);
        }

        return {
            success: true,
            taskId: result.taskId
        };

    } catch (error) {
        return toThrownResult(error);
    }
}

module.exports = {
    HELPER_URL,
    HELPER_VERSION,
    isHelperRunning,
    isPaired,
    getManualToken,
    setManualToken,
    copyToClipboard,
    readClipboard,
    startDrag,
    saveViaHelper,
    sendToWebHelper
};
