/**
 * BookmarkPanel - Left sidebar bookmark management
 */

const { invoke } = window.__TAURI__.core;

let currentFilePath = null;
let bookmarks = [];
let allBookmarks = [];
let isAllMode = false;
let searchQuery = '';
let onBookmarkClick = null;

// DOM
const panel = document.getElementById('bookmark-panel');
const listContainer = document.getElementById('bookmark-list');
const searchInput = document.getElementById('bookmark-search-input');
const toggleBtn = document.getElementById('btn-toggle-bookmark-mode');

export function init(options = {}) {
    onBookmarkClick = options.onBookmarkClick || null;

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderBookmarks();
    });

    toggleBtn.addEventListener('click', () => {
        isAllMode = !isAllMode;
        toggleBtn.textContent = isAllMode ? '\uD604\uC7AC' : '\uC804\uCCB4';
        toggleBtn.classList.toggle('active', isAllMode);
        refreshBookmarks();
    });
}

export async function loadBookmarks(filePath) {
    currentFilePath = filePath;
    await refreshBookmarks();
}

export async function refreshBookmarks() {
    if (isAllMode) {
        await loadAllBookmarks();
    } else {
        await loadFileBookmarks();
    }
}

async function loadFileBookmarks() {
    if (!currentFilePath) {
        bookmarks = [];
        renderBookmarks();
        return;
    }

    try {
        bookmarks = await invoke('get_bookmarks', { filePath: currentFilePath });
        renderBookmarks();
    } catch (err) {
        console.error('Failed to load bookmarks:', err);
        bookmarks = [];
        renderBookmarks();
    }
}

async function loadAllBookmarks() {
    try {
        if (searchQuery) {
            const results = await invoke('search_bookmarks', { query: searchQuery });
            allBookmarks = results;
        } else {
            allBookmarks = await invoke('get_all_bookmarks');
        }
        renderBookmarks();
    } catch (err) {
        console.error('Failed to load all bookmarks:', err);
        allBookmarks = [];
        renderBookmarks();
    }
}

export async function addBookmark(position, memo) {
    if (!currentFilePath) return;

    try {
        await invoke('add_bookmark', {
            filePath: currentFilePath,
            position: position,
            memo: memo || ''
        });
        await refreshBookmarks();
    } catch (err) {
        console.error('Failed to add bookmark:', err);
    }
}

export async function removeBookmark(index) {
    if (!currentFilePath) return;

    try {
        await invoke('remove_bookmark', {
            filePath: currentFilePath,
            index: index
        });
        await refreshBookmarks();
    } catch (err) {
        console.error('Failed to remove bookmark:', err);
    }
}

function renderBookmarks() {
    while (listContainer.firstChild) {
        listContainer.removeChild(listContainer.firstChild);
    }

    if (isAllMode) {
        renderAllBookmarks();
    } else {
        renderFileBookmarks();
    }
}

function renderFileBookmarks() {
    let filtered = bookmarks;
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = bookmarks.filter(b =>
            (b.memo && b.memo.toLowerCase().includes(q))
        );
    }

    if (filtered.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'bookmark-empty';
        emptyEl.textContent = '\uCC45\uAC08\uD53C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4';
        listContainer.appendChild(emptyEl);
        return;
    }

    filtered.forEach((bookmark, index) => {
        const item = createBookmarkItem(bookmark, index, false);
        listContainer.appendChild(item);
    });
}

function renderAllBookmarks() {
    if (allBookmarks.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'bookmark-empty';
        emptyEl.textContent = '\uCC45\uAC08\uD53C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4';
        listContainer.appendChild(emptyEl);
        return;
    }

    allBookmarks.forEach((result) => {
        const bookmark = result.bookmark || result;
        const item = createBookmarkItem(bookmark, -1, true, result.file_name || result.file_path);
        listContainer.appendChild(item);
    });
}

function createBookmarkItem(bookmark, index, showFile, fileName) {
    const item = document.createElement('div');
    item.className = 'bookmark-item';

    const content = document.createElement('div');
    content.className = 'bookmark-item-content';

    const memo = document.createElement('div');
    memo.className = 'bookmark-item-memo';
    memo.textContent = bookmark.memo || '(\uBA54\uBAA8 \uC5C6\uC74C)';
    content.appendChild(memo);

    const location = document.createElement('div');
    location.className = 'bookmark-item-location';
    location.textContent = '\uC904 ' + (bookmark.line || 0);
    content.appendChild(location);

    if (showFile && fileName) {
        const fileEl = document.createElement('div');
        fileEl.className = 'bookmark-item-file';
        fileEl.textContent = fileName;
        content.appendChild(fileEl);
    }

    item.appendChild(content);

    // Delete button (only for current file bookmarks)
    if (!showFile && index >= 0) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'bookmark-item-delete';
        deleteBtn.textContent = '\u00D7';
        deleteBtn.title = '\uC0AD\uC81C';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeBookmark(index);
        });
        item.appendChild(deleteBtn);
    }

    // Click to navigate
    item.addEventListener('click', () => {
        if (onBookmarkClick) {
            onBookmarkClick(bookmark.position || 0, bookmark.line || 0);
        }
    });

    return item;
}

export function togglePanel() {
    panel.classList.toggle('collapsed');
}

export function isCollapsed() {
    return panel.classList.contains('collapsed');
}

export function setCollapsed(collapsed) {
    if (collapsed) {
        panel.classList.add('collapsed');
    } else {
        panel.classList.remove('collapsed');
    }
}
