/**
 * Shared drag/drop and paste image collection for the native panel and the
 * references webview. Reads DataTransfer synchronously (getData/getAsFile are
 * only valid during the drop event) and never contacts the Photoshop helper.
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const WECHAT_DROP_HINT = '请将图片另存到文件夹再拖入，或复制后粘贴。';
const TYPE_HINT = '请拖入 PNG、JPG 或 WebP 图片。';
const SIZE_HINT = '每张图片不超过10MB。';

function toList(value) {
    if (!value) return [];
    if (typeof value.length === 'number') {
        const list = [];
        for (let index = 0; index < value.length; index++) list.push(value[index]);
        return list;
    }
    if (typeof value[Symbol.iterator] === 'function') {
        try { return Array.from(value); } catch (_) { return []; }
    }
    return [];
}

function fileLabel(file) {
    const raw = file && (file.name || file.nativePath || file.uri) || '';
    const base = String(raw).split(/[?#]/)[0].split(/[/\\]/).filter(Boolean).pop() || '';
    return base || '参考图.png';
}

function fileExtension(file) {
    const match = fileLabel(file).match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

function extensionFromText(value) {
    const base = String(value || '').split(/[?#]/)[0].split(/[/\\]/).filter(Boolean).pop() || '';
    const match = base.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

function mimeForFile(file) {
    const type = String(file && file.type || '').toLowerCase();
    if (type === 'image/jpg' || type === 'image/jpeg') return 'image/jpeg';
    if (type === 'image/png' || type === 'image/webp') return type;
    const extension = fileExtension(file);
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'png') return 'image/png';
    if (extension === 'webp') return 'image/webp';
    if (file && typeof file.dataUrl === 'string') {
        const match = file.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));/i);
        if (match) return match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    }
    return '';
}

function isAcceptedImage(file) {
    return !!(file && !file.isFolder && mimeForFile(file));
}

function isBlankShell(file) {
    if (!file || file.isFolder) return true;
    const named = file.name || file.nativePath || file.uri;
    const type = String(file.type || '');
    const size = Number(file.size);
    if (named && String(named).trim()) return false;
    if (type) return false;
    if (file.dataUrl) return false;
    if (Number.isFinite(size) && size > 0) return false;
    return true;
}

function filesFromItems(items) {
    const files = [];
    for (const item of toList(items)) {
        if (!item || (item.kind && item.kind !== 'file')) continue;
        try {
            const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
            if (file && typeof file.then !== 'function') files.push(file);
        } catch (_) {}
    }
    return files;
}

function meaningful(list) {
    return toList(list).filter(entry => entry && !entry.isFolder && !isBlankShell(entry));
}

function fileFromDataUrl(value) {
    const match = String(value || '').trim().match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return null;
    const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const payload = match[2].replace(/\s/g, '');
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
    return {
        name: '拖入图片.' + extension,
        type: mime,
        size: Math.floor(payload.length * 3 / 4),
        dataUrl: 'data:' + mime + ';base64,' + payload
    };
}

function isSafeLocalPath(value) {
    const text = String(value || '').trim();
    if (!text || /[\u0000\r\n]/.test(text)) return false;
    if (/^file:\/\//i.test(text)) {
        try {
            const url = new URL(text);
            if (url.protocol !== 'file:') return false;
            if (url.hostname && url.hostname !== 'localhost') return false;
            return ['png', 'jpg', 'jpeg', 'webp'].includes(extensionFromText(url.pathname));
        } catch (_) { return false; }
    }
    if (/^[a-zA-Z]:[\\/]/.test(text)) return ['png', 'jpg', 'jpeg', 'webp'].includes(extensionFromText(text));
    return false;
}

function toFileUri(value) {
    const text = String(value || '').trim();
    if (/^file:\/\//i.test(text)) return text;
    const normalized = text.replace(/\\/g, '/');
    const prefixed = /^[a-zA-Z]:\//.test(normalized) ? '/' + normalized : normalized;
    return 'file://' + encodeURI(prefixed).replace(/#/g, '%23');
}

function readTransferText(dataTransfer) {
    if (!dataTransfer || typeof dataTransfer.getData !== 'function') return '';
    try {
        const uriList = dataTransfer.getData('text/uri-list');
        if (uriList) return uriList;
    } catch (_) {}
    try { return dataTransfer.getData('text/plain') || ''; } catch (_) { return ''; }
}

function judge(found) {
    if (!found.length) return { images: [], notice: WECHAT_DROP_HINT };
    if (found.some(file => !isAcceptedImage(file))) return { images: [], notice: TYPE_HINT };
    if (found.some(file => Number.isFinite(Number(file.size)) && Number(file.size) > MAX_IMAGE_BYTES)) {
        return { images: [], notice: SIZE_HINT };
    }
    return { images: found.slice(), notice: null };
}

/**
 * Snapshot every synchronous DataTransfer source. Call this directly inside
 * the drop/paste listener, before any await.
 */
function gatherDroppedImages(dataTransfer) {
    const empty = { images: [], notice: WECHAT_DROP_HINT, uris: [], pendingGetFiles: null };
    if (!dataTransfer) return empty;

    const groups = [
        meaningful(dataTransfer.files),
        meaningful(filesFromItems(dataTransfer.items))
    ];
    let entries = meaningful(dataTransfer.uxpEntries);
    let pendingGetFiles = null;
    if (!entries.length && typeof dataTransfer.getFiles === 'function') {
        try {
            const got = dataTransfer.getFiles();
            if (got && typeof got.then === 'function') pendingGetFiles = got;
            else entries = meaningful(got);
        } catch (_) {}
    }
    groups.push(entries);

    for (const group of groups) {
        if (group.length) {
            const judged = judge(group);
            return { images: judged.images, notice: judged.notice, uris: [], pendingGetFiles: null };
        }
    }

    const dataFiles = [];
    const uris = [];
    for (const line of String(readTransferText(dataTransfer)).split(/\r?\n/)) {
        const text = line.trim();
        if (!text || text.startsWith('#')) continue;
        const dataFile = fileFromDataUrl(text);
        if (dataFile) dataFiles.push(dataFile);
        else if (isSafeLocalPath(text)) uris.push(text);
    }
    if (dataFiles.length) {
        const judged = judge(dataFiles);
        return { images: judged.images, notice: judged.notice, uris: [], pendingGetFiles: null };
    }
    if (pendingGetFiles || uris.length) return { images: [], notice: null, uris, pendingGetFiles };
    return empty;
}

async function finishDroppedImages(gathered, options) {
    const snapshot = gathered || { images: [], notice: WECHAT_DROP_HINT, uris: [], pendingGetFiles: null };
    if (snapshot.notice || snapshot.images.length) return { images: snapshot.images, notice: snapshot.notice };

    let found = [];
    if (snapshot.pendingGetFiles) {
        try { found = meaningful(await snapshot.pendingGetFiles); } catch (_) {}
    }
    if (!found.length && snapshot.uris && snapshot.uris.length && options && typeof options.readLocalFile === 'function') {
        for (const uri of snapshot.uris) {
            try {
                const file = await options.readLocalFile(toFileUri(uri));
                if (file) found.push(file);
            } catch (_) {}
        }
    }
    return judge(found);
}

/**
 * Collect image files from a drop or paste DataTransfer.
 * Order: files → items(getAsFile) → uxpEntries/getFiles → safe local uri-list.
 * @returns {Promise<{images: object[], notice: string|null}>}
 */
async function collectDroppedImages(dataTransfer, options) {
    return finishDroppedImages(gatherDroppedImages(dataTransfer), options);
}

function bytesToBase64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < view.length; offset += chunkSize) {
        binary += String.fromCharCode.apply(null, view.subarray(offset, Math.min(offset + chunkSize, view.length)));
    }
    if (typeof btoa === 'undefined') throw new Error('无法编码图片。');
    return btoa(binary);
}

function readImageFileAsDataUrl(file) {
    if (file && typeof file.dataUrl === 'string') return Promise.resolve(file.dataUrl);
    const mime = mimeForFile(file);
    if (!mime) return Promise.reject(new Error(TYPE_HINT));
    if (file && typeof file.arrayBuffer === 'function') {
        return Promise.resolve(file.arrayBuffer()).then(buffer => 'data:' + mime + ';base64,' + bytesToBase64(new Uint8Array(buffer)));
    }
    if (typeof FileReader === 'undefined') return Promise.reject(new Error(WECHAT_DROP_HINT));
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const payload = String(reader.result || '').split(',')[1] || '';
            resolve('data:' + mime + ';base64,' + payload);
        };
        reader.onerror = () => reject(new Error(WECHAT_DROP_HINT));
        reader.readAsDataURL(file);
    });
}

const api = {
    MAX_IMAGE_BYTES,
    WECHAT_DROP_HINT,
    collectDroppedImages,
    gatherDroppedImages,
    finishDroppedImages,
    isAcceptedImage,
    mimeForFile,
    fileLabel,
    bytesToBase64,
    readImageFileAsDataUrl
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') {
    globalThis.DropImages = api;
    globalThis.collectDroppedImages = collectDroppedImages;
}
