/**
 * BookmarkPanel - Left sidebar with file list and bookmark management
 */

import { invoke } from '@tauri-apps/api/core';

// State
let currentFilePath = null;
let bookmarks = [];
let allBookmarks = [];
let isAllMode = false;
let searchQuery = '';
let onBookmarkClick = null;
let onFileClick = null;
let onFileRemove = null;
let activeView = 'files'; // 'files' or 'bookmarks'
let fileList = [];

// DOM
const panel = document.getElementById('bookmark-panel');
const listContainer = document.getElementById('bookmark-list');
const searchInput = document.getElementById('bookmark-search-input');
const toggleBtn = document.getElementById('btn-toggle-bookmark-mode');
const fileListContainer = document.getElementById('file-list');
const fileListView = document.getElementById('file-list-view');
const bookmarkView = document.getElementById('bookmark-view');
const tabFiles = document.getElementById('panel-tab-files');
const tabBookmarks = document.getElementById('panel-tab-bookmarks');

export function init(options = {}) {
    onBookmarkClick = options.onBookmarkClick || null;
    onFileClick = options.onFileClick || null;
    onFileRemove = options.onFileRemove || null;

    // Tab switching
    tabFiles.addEventListener('click', () => switchView('files'));
    tabBookmarks.addEventListener('click', () => switchView('bookmarks'));

    // Bookmark search
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderBookmarks();
    });

    // Bookmark mode toggle
    toggleBtn.addEventListener('click', () => {
        isAllMode = !isAllMode;
        toggleBtn.textContent = isAllMode ? '\uD604\uC7AC' : '\uC804\uCCB4';
        toggleBtn.classList.toggle('active', isAllMode);
        refreshBookmarks();
    });

    // Load file list on init
    refreshFileList();
}

function switchView(view) {
    activeView = view;
    if (view === 'files') {
        tabFiles.classList.add('active');
        tabBookmarks.classList.remove('active');
        fileListView.classList.remove('hidden');
        bookmarkView.classList.add('hidden');
    } else {
        tabBookmarks.classList.add('active');
        tabFiles.classList.remove('active');
        bookmarkView.classList.remove('hidden');
        fileListView.classList.add('hidden');
    }
}

// ============================================================
// File List
// ============================================================

export async function refreshFileList() {
    try {
        fileList = await invoke('get_file_list');
        renderFileList();
    } catch (err) {
        console.error('Failed to load file list:', err);
        fileList = [];
        renderFileList();
    }
}

function renderFileList() {
    while (fileListContainer.firstChild) {
        fileListContainer.removeChild(fileListContainer.firstChild);
    }

    if (fileList.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'bookmark-empty';
        emptyEl.textContent = '\uC5F4\uC5B4\uBCF8 \uD30C\uC77C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4';
        fileListContainer.appendChild(emptyEl);
        return;
    }

    fileList.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'file-list-item';
        if (entry.file_path === currentFilePath) {
            item.classList.add('active');
        }

        const content = document.createElement('div');
        content.className = 'file-list-item-content';

        const nameEl = document.createElement('div');
        nameEl.className = 'file-list-item-name';
        nameEl.textContent = entry.file_name;
        content.appendChild(nameEl);

        const metaEl = document.createElement('div');
        metaEl.className = 'file-list-item-meta';
        const parts = [];
        if (entry.bookmark_count > 0) {
            parts.push('\uCC45\uAC08\uD53C ' + entry.bookmark_count);
        }
        if (entry.last_position > 0) {
            parts.push('\uC904 ' + entry.last_position);
        }
        metaEl.textContent = parts.join(' \u00B7 ');
        content.appendChild(metaEl);

        const pathEl = document.createElement('div');
        pathEl.className = 'file-list-item-path';
        pathEl.textContent = entry.file_path;
        pathEl.title = entry.file_path;
        content.appendChild(pathEl);

        item.appendChild(content);

        // Delete button (trash icon)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'file-list-item-delete';
        deleteBtn.title = '\uBAA9\uB85D\uC5D0\uC11C \uC0AD\uC81C';
        const trashSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        trashSvg.setAttribute('width', '14');
        trashSvg.setAttribute('height', '14');
        trashSvg.setAttribute('viewBox', '0 0 16 16');
        trashSvg.setAttribute('fill', 'currentColor');
        const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path1.setAttribute('d', 'M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z');
        const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path2.setAttribute('fill-rule', 'evenodd');
        path2.setAttribute('d', 'M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H5.5l1-1h3l1 1H13a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z');
        trashSvg.appendChild(path1);
        trashSvg.appendChild(path2);
        deleteBtn.appendChild(trashSvg);
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showDeleteConfirm(entry.file_path, entry.file_name, entry.bookmark_count);
        });
        item.appendChild(deleteBtn);

        // Click to open file
        item.addEventListener('click', () => {
            if (onFileClick) {
                onFileClick(entry.file_path);
            }
        });

        fileListContainer.appendChild(item);
    });
}

// Delete confirmation dialog
const deleteDialog = document.getElementById('file-delete-dialog');
const deleteNameEl = document.getElementById('file-delete-name');
const btnDeleteConfirm = document.getElementById('btn-file-delete-confirm');
const btnDeleteCancel = document.getElementById('btn-file-delete-cancel');
const btnDeleteClose = document.getElementById('btn-file-delete-close');

let pendingDeletePath = null;
let deleteCleanup = null;

function showDeleteConfirm(filePath, fileName, bookmarkCount) {
    pendingDeletePath = filePath;
    let nameText = fileName;
    if (bookmarkCount > 0) {
        nameText += ' (\uCC45\uAC08\uD53C ' + bookmarkCount + '\uAC1C)';
    }
    deleteNameEl.textContent = nameText;
    deleteDialog.classList.remove('hidden');

    function doClose() {
        deleteDialog.classList.add('hidden');
        pendingDeletePath = null;
        cleanup();
    }

    function doConfirm() {
        if (pendingDeletePath) {
            removeFileEntry(pendingDeletePath);
        }
        doClose();
    }

    function onOverlay(e) {
        if (e.target === deleteDialog) doClose();
    }

    function onKey(e) {
        if (e.key === 'Escape') doClose();
        if (e.key === 'Enter') doConfirm();
    }

    function cleanup() {
        btnDeleteConfirm.removeEventListener('click', doConfirm);
        btnDeleteCancel.removeEventListener('click', doClose);
        btnDeleteClose.removeEventListener('click', doClose);
        deleteDialog.removeEventListener('click', onOverlay);
        document.removeEventListener('keydown', onKey);
    }

    btnDeleteConfirm.addEventListener('click', doConfirm);
    btnDeleteCancel.addEventListener('click', doClose);
    btnDeleteClose.addEventListener('click', doClose);
    deleteDialog.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
}

async function removeFileEntry(filePath) {
    try {
        await invoke('remove_file_entry', { filePath: filePath });
        await refreshFileList();
        if (onFileRemove) onFileRemove(filePath);
    } catch (err) {
        console.error('Failed to remove file entry:', err);
    }
}

// ============================================================
// Bookmarks
// ============================================================

export async function loadBookmarks(filePath) {
    currentFilePath = filePath;
    await refreshBookmarks();
    // Re-render file list to update active state
    renderFileList();
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
        // Update file list to reflect new bookmark count
        await refreshFileList();
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
        await refreshFileList();
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

// ============================================================
// Panel Controls
// ============================================================

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
