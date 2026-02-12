/**
 * SearchDialog - Find/Replace floating dialog
 */

import { invoke } from '@tauri-apps/api/core';

let isVisible = false;
let isReplaceMode = false;
let matches = [];
let currentMatchIndex = -1;
let currentFileId = null;
let onMatchesUpdate = null;
let onActiveMatchChange = null;
let searchTimeout = null;

// DOM
const dialog = document.getElementById('search-dialog');
const searchInput = document.getElementById('search-input');
const caseSensitiveCheckbox = document.getElementById('search-case-sensitive');
const searchCount = document.getElementById('search-count');
const replaceRow = document.getElementById('replace-row');
const replaceInput = document.getElementById('replace-input');
const btnPrev = document.getElementById('btn-search-prev');
const btnNext = document.getElementById('btn-search-next');
const btnClose = document.getElementById('btn-search-close');
const btnReplace = document.getElementById('btn-replace');
const btnReplaceAll = document.getElementById('btn-replace-all');

export function init(options = {}) {
    onMatchesUpdate = options.onMatchesUpdate || null;
    onActiveMatchChange = options.onActiveMatchChange || null;

    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performSearch();
        }, 300);
    });

    caseSensitiveCheckbox.addEventListener('change', () => {
        performSearch();
    });

    btnPrev.addEventListener('click', prevMatch);
    btnNext.addEventListener('click', nextMatch);
    btnClose.addEventListener('click', hide);
    btnReplace.addEventListener('click', replaceOne);
    btnReplaceAll.addEventListener('click', replaceAll);

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
                prevMatch();
            } else {
                nextMatch();
            }
        }
        if (e.key === 'Escape') {
            hide();
        }
    });

    replaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            replaceOne();
        }
        if (e.key === 'Escape') {
            hide();
        }
    });
}

export function show(replaceMode = false) {
    isVisible = true;
    isReplaceMode = replaceMode;
    dialog.classList.remove('hidden');

    if (replaceMode) {
        replaceRow.classList.remove('hidden');
    } else {
        replaceRow.classList.add('hidden');
    }

    searchInput.focus();
    searchInput.select();
}

export function hide() {
    isVisible = false;
    dialog.classList.add('hidden');
    matches = [];
    currentMatchIndex = -1;
    searchCount.textContent = '\uACB0\uACFC \uC5C6\uC74C';

    if (onMatchesUpdate) onMatchesUpdate([], -1);
}

export function toggle(replaceMode = false) {
    if (isVisible && isReplaceMode === replaceMode) {
        hide();
    } else {
        show(replaceMode);
    }
}

export function setFileId(fileId) {
    currentFileId = fileId;
    matches = [];
    currentMatchIndex = -1;
    searchCount.textContent = '\uACB0\uACFC \uC5C6\uC74C';
    searchInput.value = '';
    replaceInput.value = '';
}

export function isOpen() {
    return isVisible;
}

async function performSearch() {
    const query = searchInput.value;
    if (!query || !currentFileId) {
        matches = [];
        currentMatchIndex = -1;
        searchCount.textContent = '\uACB0\uACFC \uC5C6\uC74C';
        if (onMatchesUpdate) onMatchesUpdate([], -1);
        return;
    }

    try {
        const caseSensitive = caseSensitiveCheckbox.checked;
        matches = await invoke('search_text', {
            fileId: currentFileId,
            query: query,
            caseSensitive: caseSensitive
        });

        console.log('[Search] Results for "' + query + '":', matches.map((m, i) =>
            'match ' + i + ': line=' + m.line + ' charStart=' + m.line_char_start + ' charEnd=' + m.line_char_end
        ));

        if (matches.length > 0) {
            currentMatchIndex = 0;
            searchCount.textContent = '1 / ' + matches.length;
        } else {
            currentMatchIndex = -1;
            searchCount.textContent = '\uACB0\uACFC \uC5C6\uC74C';
        }

        if (onMatchesUpdate) onMatchesUpdate(matches, currentMatchIndex);
        if (onActiveMatchChange && currentMatchIndex >= 0) {
            onActiveMatchChange(currentMatchIndex);
        }
    } catch (err) {
        console.error('Search failed:', err);
        matches = [];
        currentMatchIndex = -1;
        searchCount.textContent = '\uC624\uB958';
    }
}

function nextMatch() {
    if (matches.length === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % matches.length;
    searchCount.textContent = (currentMatchIndex + 1) + ' / ' + matches.length;
    if (onActiveMatchChange) onActiveMatchChange(currentMatchIndex);
}

function prevMatch() {
    if (matches.length === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    searchCount.textContent = (currentMatchIndex + 1) + ' / ' + matches.length;
    if (onActiveMatchChange) onActiveMatchChange(currentMatchIndex);
}

async function replaceOne() {
    if (matches.length === 0 || currentMatchIndex < 0 || !currentFileId) return;

    const query = searchInput.value;
    const replacement = replaceInput.value;
    const caseSensitive = caseSensitiveCheckbox.checked;
    const match = matches[currentMatchIndex];

    try {
        await invoke('replace_text', {
            fileId: currentFileId,
            query: query,
            replacement: replacement,
            position: match.char_start,
            caseSensitive: caseSensitive
        });

        await performSearch();
    } catch (err) {
        console.error('Replace failed:', err);
    }
}

async function replaceAll() {
    if (!searchInput.value || !currentFileId) return;

    const query = searchInput.value;
    const replacement = replaceInput.value;
    const caseSensitive = caseSensitiveCheckbox.checked;

    try {
        const count = await invoke('replace_all_text', {
            fileId: currentFileId,
            query: query,
            replacement: replacement,
            caseSensitive: caseSensitive
        });

        searchCount.textContent = count + '\uAC1C \uAD50\uCCB4\uB428';
        matches = [];
        currentMatchIndex = -1;

        if (onMatchesUpdate) onMatchesUpdate([], -1);
    } catch (err) {
        console.error('Replace all failed:', err);
    }
}
