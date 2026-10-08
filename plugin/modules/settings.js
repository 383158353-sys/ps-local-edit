/**
 * Settings Management Module
 * Handles loading, saving, and UI rendering for Aspect Ratio Settings
 */

const helper = require('./helper.js');

const DEFAULT_RATIOS = [
    { id: '3:2', label: '2:3 and 3:2', enabled: true, landscapeValue: 1.5, portraitValue: 2/3, landscapeName: '3:2', portraitName: '2:3' },
    { id: '16:9', label: '9:16 and 16:9', enabled: true, landscapeValue: 16/9, portraitValue: 9/16, landscapeName: '16:9', portraitName: '9:16' },
    { id: '4:3', label: '3:4 and 4:3', enabled: true, landscapeValue: 4/3, portraitValue: 3/4, landscapeName: '4:3', portraitName: '3:4' },
    { id: '21:9', label: '9:21 and 21:9', enabled: false, landscapeValue: 21/9, portraitValue: 9/21, landscapeName: '21:9', portraitName: '9:21' },
    { id: '2:1', label: '1:2 and 2:1', enabled: false, landscapeValue: 2, portraitValue: 1/2, landscapeName: '2:1', portraitName: '1:2' },
    { id: '5:4', label: '4:5 and 5:4', enabled: false, landscapeValue: 5/4, portraitValue: 4/5, landscapeName: '5:4', portraitName: '4:5' }
];

let currentSettings = [];
let editingSettings = [];

let highlightedRatioId = null;
let highlightTimeoutId = null;

let showFeatherPanel = false;
let currentFeatherSettings = null;
let settingsChangeListeners = [];

/**
 * Register listener for settings changes
 * @param {Function} listener
 */
function onSettingsChanged(listener) {
    if (typeof listener === 'function') {
        settingsChangeListeners.push(listener);
    }
}

/**
 * Notify all settings change listeners
 */
function notifySettingsChanged() {
    settingsChangeListeners.forEach(fn => {
        try { fn(); } catch (e) { console.error('Error in settings change listener:', e); }
    });
}

/**
 * Get showFeatherPanel preference
 * @returns {boolean}
 */
function getShowFeatherPanel() {
    try {
        const val = window.localStorage.getItem('show-feather-panel');
        if (val === null) return false;
        return val === 'true';
    } catch (e) {
        console.error("Failed to get showFeatherPanel:", e);
        return false;
    }
}

/**
 * Set showFeatherPanel preference
 * @param {boolean} val
 */
function setShowFeatherPanel(val) {
    try {
        showFeatherPanel = !!val;
        window.localStorage.setItem('show-feather-panel', showFeatherPanel ? 'true' : 'false');
    } catch (e) {
        console.error("Failed to set showFeatherPanel:", e);
    }
}

/**
 * Get featherSettings from localStorage or create from MASK_FEATHER template
 * Guaranteed to have bias: 1.0 in stored settings
 * @returns {object}
 */
function getFeatherSettings() {
    try {
        const raw = window.localStorage.getItem('feather-settings');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                // Bias is ALWAYS 1.0 in persistent stored settings
                parsed.bias = 1.0;
                currentFeatherSettings = parsed;
                return parsed;
            }
        }
    } catch (e) {
        console.error("Failed to load featherSettings:", e);
    }

    // Default template fallback from ps.js
    let template;
    try {
        const ps = require('./ps.js');
        template = ps.MASK_FEATHER;
    } catch (e) {
        template = null;
    }

    if (!template) {
        template = {
            enabled: false,
            bias: 1.0,
            relative: 0.015,
            minRadius: 2,
            maxRadius: 20,
            paddingShare: 0.4,
            selectionShare: 0.25
        };
    }

    const initial = Object.assign({}, template, {
        enabled: false,
        bias: 1.0
    });

    saveFeatherSettings(initial);
    return initial;
}

/**
 * Save featherSettings to localStorage (ensures bias is locked to 1.0 in storage)
 * @param {object} settingsObj
 */
function saveFeatherSettings(settingsObj) {
    try {
        const toSave = Object.assign({}, settingsObj, { bias: 1.0 });
        window.localStorage.setItem('feather-settings', JSON.stringify(toSave));
        currentFeatherSettings = toSave;
    } catch (e) {
        console.error("Failed to save featherSettings:", e);
    }
}

/**
 * Clear any active highlight and its timeout
 */
function clearHighlight() {
    if (highlightTimeoutId) {
        clearTimeout(highlightTimeoutId);
        highlightTimeoutId = null;
    }
    highlightedRatioId = null;
}

/**
 * Load settings from localStorage
 */
function loadSettings() {
    try {
        // Migrate settings if the new version with updated defaults hasn't been set yet
        const version = window.localStorage.getItem('aspect-ratio-settings-v2');
        if (version !== 'true') {
            currentSettings = JSON.parse(JSON.stringify(DEFAULT_RATIOS));
            window.localStorage.setItem('aspect-ratio-settings', JSON.stringify(currentSettings));
            window.localStorage.setItem('aspect-ratio-settings-v2', 'true');
            console.log("Migrated aspect ratio settings to V2 defaults:", currentSettings);
            return;
        }

        const raw = window.localStorage.getItem('aspect-ratio-settings');
        if (raw) {
            currentSettings = JSON.parse(raw);
            // Ensure any missing fields from default schema are populated
            if (!Array.isArray(currentSettings) || currentSettings.length === 0) {
                currentSettings = JSON.parse(JSON.stringify(DEFAULT_RATIOS));
            }
        } else {
            currentSettings = JSON.parse(JSON.stringify(DEFAULT_RATIOS));
        }
    } catch (e) {
        console.error("Failed to load settings:", e);
        currentSettings = JSON.parse(JSON.stringify(DEFAULT_RATIOS));
    }
}

/**
 * Save settings to localStorage
 */
function saveSettings(settings) {
    try {
        window.localStorage.setItem('aspect-ratio-settings', JSON.stringify(settings));
        currentSettings = JSON.parse(JSON.stringify(settings));
        console.log("Settings saved successfully:", currentSettings);
    } catch (e) {
        console.error("Failed to save settings:", e);
    }
}

/**
 * Get active/enabled aspect ratios in their sorted order
 * @returns {Array} List of enabled aspect ratio configurations
 */
function getEnabledRatios() {
    loadSettings();
    return currentSettings.filter(r => r.enabled);
}

/**
 * Render the settings list rows dynamically
 */
function renderList(listContainer) {
    listContainer.innerHTML = '';
    
    editingSettings.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'setting-row';
        if (item.id === highlightedRatioId) {
            row.classList.add('highlighted');
        }

        // Checkbox element
        const checkbox = document.createElement('sp-checkbox');
        checkbox.textContent = item.label;
        checkbox.className = 'setting-checkbox';
        checkbox.checked = item.enabled;
        if (item.enabled) {
            checkbox.setAttribute('checked', '');
        }
        checkbox.addEventListener('change', () => {
            item.enabled = checkbox.checked;
        });

        // Buttons container
        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'setting-sort-buttons';

        // Up button
        const btnUp = document.createElement('sp-action-button');
        btnUp.setAttribute('quiet', '');
        btnUp.setAttribute('size', 's');
        if (index === 0) {
            btnUp.setAttribute('disabled', '');
        }
        btnUp.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" height="12" viewBox="0 0 18 18" width="12">
                <path fill="currentColor" d="M9,5.5a1,1,0,0,1,.707.293l6,6a1,1,0,0,1-1.414,1.414L9,7.914,3.707,13.207A1,1,0,0,1,2.293,11.793l6-6A1,1,0,0,1,9,5.5Z"/>
            </svg>
        `;
        btnUp.addEventListener('click', () => {
            if (index > 0) {
                const temp = editingSettings[index];
                editingSettings[index] = editingSettings[index - 1];
                editingSettings[index - 1] = temp;
                
                clearHighlight();
                highlightedRatioId = temp.id;
                highlightTimeoutId = setTimeout(() => {
                    clearHighlight();
                    renderList(listContainer);
                }, 1500);

                renderList(listContainer);
            }
        });

        // Down button
        const btnDown = document.createElement('sp-action-button');
        btnDown.setAttribute('quiet', '');
        btnDown.setAttribute('size', 's');
        if (index === editingSettings.length - 1) {
            btnDown.setAttribute('disabled', '');
        }
        btnDown.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" height="12" viewBox="0 0 18 18" width="12">
                <path fill="currentColor" d="M9,12.5a1,1,0,0,1-.707-.293l-6-6A1,1,0,0,1,3.707,4.793L9,10.086l5.293-5.293a1,1,0,0,1,1.414,1.414l-6,6A1,1,0,0,1,9,12.5Z"/>
            </svg>
        `;
        btnDown.addEventListener('click', () => {
            if (index < editingSettings.length - 1) {
                const temp = editingSettings[index];
                editingSettings[index] = editingSettings[index + 1];
                editingSettings[index + 1] = temp;
                
                clearHighlight();
                highlightedRatioId = temp.id;
                highlightTimeoutId = setTimeout(() => {
                    clearHighlight();
                    renderList(listContainer);
                }, 1500);

                renderList(listContainer);
            }
        });

        buttonsDiv.appendChild(btnUp);
        buttonsDiv.appendChild(btnDown);
        
        row.appendChild(checkbox);
        row.appendChild(buttonsDiv);
        listContainer.appendChild(row);
    });
}

let tokenStatusPollTimer = null;

/**
 * Show whether the panel currently holds a Helper token.
 *
 * Pairing is normally automatic, so the field is only meaningful when it has failed.
 * Reporting the current state avoids the user guessing whether they need to act.
 */
async function refreshTokenStatus() {
    const statusEl = document.getElementById('settings-helper-token-status');
    if (!statusEl) return false;

    const paired = await helper.isPaired();
    statusEl.textContent = paired ? 'Paired ✓' : 'Not paired — Helper actions are unavailable';
    statusEl.className = paired ? 'settings-token-status is-paired' : 'settings-token-status is-unpaired';
    return paired;
}

/**
 * Start periodic token status polling while settings dialog is open.
 *
 * Stops itself as soon as pairing is confirmed — there is nothing left to wait for once
 * the Helper has written the token, so polling on is just wasted work.
 */
function startTokenStatusPolling() {
    stopTokenStatusPolling();
    refreshTokenStatus().then(paired => {
        if (paired) return;

        tokenStatusPollTimer = setInterval(async () => {
            const nowPaired = await refreshTokenStatus();
            if (nowPaired) stopTokenStatusPolling();
        }, 1500);
    });
}

/**
 * Stop periodic token status polling when settings dialog closes.
 */
function stopTokenStatusPolling() {
    if (tokenStatusPollTimer) {
        clearInterval(tokenStatusPollTimer);
        tokenStatusPollTimer = null;
    }
}

/**
 * Initialize event handlers for Save and Cancel buttons in dialog
 */
function initSettings() {
    loadSettings();

    const dialog = document.getElementById('settings-dialog');
    if (!dialog) {
        console.warn('Settings dialog DOM element not found');
        return;
    }

    dialog.addEventListener('close', () => {
        stopTokenStatusPolling();
    });

    const btnSave = document.getElementById('btn-settings-save');
    const btnCancel = document.getElementById('btn-settings-cancel');

    if (btnSave) {
        btnSave.addEventListener('click', (e) => {
            e.preventDefault();
            clearHighlight();
            stopTokenStatusPolling();
            saveSettings(editingSettings);

            const tokenField = document.getElementById('settings-helper-token');
            if (tokenField) {
                // An empty field clears the override and returns to automatic pairing.
                helper.setManualToken(tokenField.value || '');
            }

            const featherCheckbox = document.getElementById('settings-show-feather');
            if (featherCheckbox) {
                setShowFeatherPanel(featherCheckbox.checked);
            }

            notifySettingsChanged();

            dialog.close();
        });
    }

    if (btnCancel) {
        btnCancel.addEventListener('click', (e) => {
            e.preventDefault();
            clearHighlight();
            stopTokenStatusPolling();
            dialog.close();
        });
    }
}

/**
 * Open the settings modal dialog
 */
function showSettingsDialog() {
    clearHighlight();
    loadSettings();
    editingSettings = JSON.parse(JSON.stringify(currentSettings));

    const dialog = document.getElementById('settings-dialog');
    const listContainer = document.getElementById('settings-ratios-list');

    if (dialog && listContainer) {
        renderList(listContainer);

        const tokenField = document.getElementById('settings-helper-token');
        if (tokenField) {
            tokenField.value = helper.getManualToken();
        }
        startTokenStatusPolling();

        const featherCheckbox = document.getElementById('settings-show-feather');
        if (featherCheckbox) {
            const isShown = getShowFeatherPanel();
            featherCheckbox.checked = isShown;
            if (isShown) {
                featherCheckbox.setAttribute('checked', '');
            } else {
                featherCheckbox.removeAttribute('checked');
            }
        }

        try {
            if (typeof dialog.uxpShowModal === 'function') {
                dialog.uxpShowModal({ size: { width: 320, height: 480 } });
            } else {
                dialog.showModal();
            }
        } catch (e) {
            console.error("Failed to open dialog via showModal:", e);
        }
    } else {
        console.error("Required DOM elements for settings dialog not found");
    }
}

module.exports = {
    initSettings,
    showSettingsDialog,
    getEnabledRatios,
    getShowFeatherPanel,
    setShowFeatherPanel,
    getFeatherSettings,
    saveFeatherSettings,
    onSettingsChanged
};
