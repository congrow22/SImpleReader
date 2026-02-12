/**
 * SImpleReader - Main Application Entry Point
 * Initializes all components, sets up keyboard shortcuts, and manages app state.
 */

import * as MenuBar from './components/MenuBar.js';
import * as TabBar from './components/TabBar.js';
import * as Editor from './components/Editor.js';
import * as BookmarkPanel from './components/BookmarkPanel.js';
import * as SearchDialog from './components/SearchDialog.js';
import * as SettingsDialog from './components/SettingsDialog.js';
import * as FormatDialog from './components/FormatDialog.js';
import * as GoToLineDialog from './components/GoToLineDialog.js';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ============================================================
// Application State
// ============================================================

const state = {
    files: new Map(), // fileId -> fileInfo
    activeFileId: null
};

// ============================================================
// Initialization
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    await initApp();
});

async function initApp() {
    // Load config and apply settings
    try {
        const config = await invoke('get_config');
        applyConfig(config);
    } catch (err) {
        console.warn('Could not load config:', err);
    }

    // Initialize all components
    initMenuBar();
    initTabBar();
    initEditor();
    initBookmarkPanel();
    initSearchDialog();
    initSettingsDialog();
    initFormatDialog();
    initGoToLineDialog();
    initSidebarResize();
    initKeyboardShortcuts();
    initDragAndDrop();
    initWelcome();

    // Save button
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        btnSave.addEventListener('click', handleSave);
    }

    // Edit mode toggle button
    const btnEditMode = document.getElementById('btn-edit-mode');
    if (btnEditMode) {
        btnEditMode.addEventListener('click', handleToggleEditMode);
    }

    // Load any open tabs from backend
    try {
        const tabs = await invoke('get_open_tabs');
        if (tabs && tabs.length > 0) {
            for (const tab of tabs) {
                const fileInfo = {
                    id: tab.id,
                    name: tab.name,
                    path: tab.path,
                    total_lines: 0,
                    is_modified: tab.is_modified
                };
                state.files.set(tab.id, fileInfo);
                TabBar.addTab(fileInfo);
            }
        }
    } catch (err) {
        // No open tabs, that is fine
    }
}

function applyConfig(config) {
    if (config.font_size) {
        document.documentElement.style.setProperty('--font-size-editor', config.font_size + 'px');
    }
    if (config.font_family) {
        document.documentElement.style.setProperty('--font-mono', config.font_family);
    }
}

// ============================================================
// Component Initialization
// ============================================================

function initMenuBar() {
    MenuBar.init(handleMenuAction);
}

function initTabBar() {
    TabBar.init({
        onSwitch: handleTabSwitch,
        onClose: handleTabClose,
        onNew: handleOpenFile
    });
}

function initEditor() {
    Editor.init({
        onModified: (fileId) => {
            const info = state.files.get(fileId);
            if (info) info.is_modified = true;
            TabBar.updateTab(fileId, { is_modified: true });
            updateStatusBar();
        },
        onLineChange: (currentLine, totalLines) => {
            updateStatusLine(currentLine, totalLines);
        },
        onEditModeChange: (editMode) => {
            updateEditModeUI(editMode);
        }
    });
}

function initBookmarkPanel() {
    BookmarkPanel.init({
        onBookmarkClick: (position, line) => {
            if (line > 0) {
                Editor.scrollToLine(line);
            }
        },
        onFileClick: async (filePath) => {
            await openFile(filePath);
        },
        onFileRemove: (filePath) => {
            // Close the tab if this file is currently open
            for (const [fileId, info] of state.files) {
                if (info.path === filePath) {
                    handleTabClose(fileId);
                    break;
                }
            }
        }
    });
}

function initSearchDialog() {
    SearchDialog.init({
        onMatchesUpdate: (matches, activeIndex) => {
            Editor.setSearchMatches(matches, activeIndex);
        },
        onActiveMatchChange: (index) => {
            Editor.setActiveMatch(index);
        }
    });
}

function initSettingsDialog() {
    SettingsDialog.init({
        onApply: (config) => {
            if (config.font_size) {
                Editor.updateFontSize(config.font_size);
            }
            if (config.font_family) {
                Editor.updateFontFamily(config.font_family);
            }
        }
    });
}

function initFormatDialog() {
    FormatDialog.init({
        onFormatApplied: () => {
            Editor.refreshContent();
            if (state.activeFileId) {
                TabBar.updateTab(state.activeFileId, { is_modified: true });
            }
            updateStatusBar();
        }
    });
}

function initGoToLineDialog() {
    GoToLineDialog.init({
        onGoToLine: (lineNumber) => {
            Editor.scrollToLine(lineNumber);
        }
    });
}

function initSidebarResize() {
    const handle = document.getElementById('sidebar-resize-handle');
    const panel = document.getElementById('bookmark-panel');
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const diff = e.clientX - startX;
        const newWidth = Math.max(180, Math.min(400, startWidth + diff));
        panel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

function initWelcome() {
    const btnWelcomeOpen = document.getElementById('btn-welcome-open');
    if (btnWelcomeOpen) {
        btnWelcomeOpen.addEventListener('click', handleOpenFile);
    }
}

// ============================================================
// Keyboard Shortcuts
// ============================================================

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        // Ctrl+O: Open file
        if (ctrl && !shift && e.key === 'o') {
            e.preventDefault();
            handleOpenFile();
            return;
        }

        // Ctrl+S: Save
        if (ctrl && !shift && e.key === 's') {
            e.preventDefault();
            handleSave();
            return;
        }

        // Ctrl+W: Close tab
        if (ctrl && !shift && e.key === 'w') {
            e.preventDefault();
            handleCloseCurrentTab();
            return;
        }

        // Ctrl+F: Find
        if (ctrl && !shift && e.key === 'f') {
            e.preventDefault();
            SearchDialog.toggle(false);
            if (SearchDialog.isOpen()) {
                SearchDialog.setFileId(Editor.getCurrentFileId());
            }
            return;
        }

        // Ctrl+H: Replace
        if (ctrl && !shift && e.key === 'h') {
            e.preventDefault();
            SearchDialog.toggle(true);
            if (SearchDialog.isOpen()) {
                SearchDialog.setFileId(Editor.getCurrentFileId());
            }
            return;
        }

        // Ctrl+Z: Undo
        if (ctrl && !shift && e.key === 'z') {
            e.preventDefault();
            Editor.undo();
            return;
        }

        // Ctrl+Y: Redo
        if (ctrl && !shift && e.key === 'y') {
            e.preventDefault();
            Editor.redo();
            return;
        }

        // Ctrl+B: Toggle bookmark panel / Add bookmark
        if (ctrl && !shift && e.key === 'b') {
            e.preventDefault();
            handleAddBookmark();
            return;
        }

        // Ctrl+G: Go to line
        if (ctrl && !shift && e.key === 'g') {
            e.preventDefault();
            GoToLineDialog.show(Editor.getCurrentLine(), Editor.getTotalLines());
            return;
        }

        // Ctrl+Tab: Next tab
        if (ctrl && !shift && e.key === 'Tab') {
            e.preventDefault();
            TabBar.nextTab();
            return;
        }

        // Ctrl+Shift+Tab: Previous tab
        if (ctrl && shift && e.key === 'Tab') {
            e.preventDefault();
            TabBar.prevTab();
            return;
        }

        // Ctrl+Shift+F: Text formatting
        if (ctrl && shift && e.key === 'F') {
            e.preventDefault();
            const fileId = Editor.getCurrentFileId();
            if (fileId) {
                FormatDialog.show(fileId);
            }
            return;
        }

        // F2: Toggle edit mode
        if (e.key === 'F2') {
            e.preventDefault();
            handleToggleEditMode();
            return;
        }

        // Escape: Close dialogs
        if (e.key === 'Escape') {
            if (SearchDialog.isOpen()) {
                SearchDialog.hide();
                Editor.clearSearchHighlights();
            }
            MenuBar.close();
            return;
        }
    });
}

// ============================================================
// Drag and Drop
// ============================================================

function initDragAndDrop() {
    const overlay = document.getElementById('drop-overlay');

    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dragCounter === 1) {
            overlay.classList.remove('hidden');
        }
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            overlay.classList.add('hidden');
        }
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.classList.add('hidden');

        // In Tauri 2, dropped files come through a different mechanism.
        // Try to get file paths from the event.
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            for (const file of e.dataTransfer.files) {
                // In Tauri, file.path should give us the actual file path
                const path = file.path || file.name;
                if (path) {
                    await openFile(path);
                }
            }
        }
    });

    // Also listen for Tauri drag-drop events
    try {
        listen('tauri://drag-drop', async (event) => {
            overlay.classList.add('hidden');
            dragCounter = 0;
            const paths = event.payload.paths || event.payload;
            if (Array.isArray(paths)) {
                for (const path of paths) {
                    await openFile(path);
                }
            }
        });

        listen('tauri://drag-enter', () => {
            overlay.classList.remove('hidden');
        });

        listen('tauri://drag-leave', () => {
            overlay.classList.add('hidden');
            dragCounter = 0;
        });
    } catch (err) {
        console.warn('Tauri drag-drop events not available:', err);
    }
}

// ============================================================
// Menu Action Handler
// ============================================================

function handleMenuAction(action) {
    switch (action) {
        case 'open':
            handleOpenFile();
            break;
        case 'save':
            handleSave();
            break;
        case 'close':
            handleCloseCurrentTab();
            break;
        case 'undo':
            Editor.undo();
            break;
        case 'redo':
            Editor.redo();
            break;
        case 'find':
            SearchDialog.show(false);
            SearchDialog.setFileId(Editor.getCurrentFileId());
            break;
        case 'replace':
            SearchDialog.show(true);
            SearchDialog.setFileId(Editor.getCurrentFileId());
            break;
        case 'format': {
            const fileId = Editor.getCurrentFileId();
            if (fileId) FormatDialog.show(fileId);
            break;
        }
        case 'goto-line':
            GoToLineDialog.show(Editor.getCurrentLine(), Editor.getTotalLines());
            break;
        case 'toggle-edit-mode':
            handleToggleEditMode();
            break;
        case 'toggle-bookmark-panel':
            BookmarkPanel.togglePanel();
            break;
        case 'add-bookmark':
            handleAddBookmark();
            break;
        case 'settings':
            SettingsDialog.show();
            break;
        case 'help':
            showHelp();
            break;
    }
}

// ============================================================
// File Operations
// ============================================================

async function handleOpenFile() {
    try {
        const filePath = await openDialog({
            multiple: false,
            filters: [{ name: 'Text Files', extensions: ['txt', 'md', 'log', 'csv', 'json'] }]
        });

        if (filePath) {
            await openFile(filePath);
        }
    } catch (err) {
        console.error('Failed to open file dialog:', err);
    }
}

async function openFile(path) {
    try {
        const fileInfo = await invoke('open_file', { path: path });

        state.files.set(fileInfo.id, fileInfo);
        state.activeFileId = fileInfo.id;

        TabBar.addTab(fileInfo);
        await Editor.loadFile(fileInfo);

        SearchDialog.setFileId(fileInfo.id);
        BookmarkPanel.loadBookmarks(fileInfo.path);

        // Track file open for file list
        try {
            await invoke('track_file_open', { filePath: fileInfo.path });
            BookmarkPanel.refreshFileList();
        } catch (e) {
            // non-critical
        }

        updateStatusBar();
    } catch (err) {
        console.error('Failed to open file:', err);
    }
}

async function handleSave() {
    const fileId = Editor.getCurrentFileId();
    if (!fileId) return;

    try {
        await invoke('save_file', { fileId: fileId });
        const info = state.files.get(fileId);
        if (info) info.is_modified = false;
        TabBar.updateTab(fileId, { is_modified: false });
        updateStatusBar();
    } catch (err) {
        console.error('Failed to save file:', err);
    }
}

async function handleCloseCurrentTab() {
    const fileId = TabBar.getActiveTabId();
    if (!fileId) return;

    await handleTabClose(fileId);
}

async function handleTabClose(fileId) {
    try {
        await invoke('close_file', { fileId: fileId });
    } catch (err) {
        console.warn('close_file error:', err);
    }

    state.files.delete(fileId);
    TabBar.removeTab(fileId);

    const newActiveId = TabBar.getActiveTabId();
    if (!newActiveId) {
        state.activeFileId = null;
        Editor.clear();
        SearchDialog.setFileId(null);
        updateStatusBar();
    }
}

async function handleTabSwitch(fileId) {
    if (!fileId) {
        state.activeFileId = null;
        Editor.clear();
        updateStatusBar();
        return;
    }

    state.activeFileId = fileId;

    // Save last position for previous file
    const prevFilePath = Editor.getCurrentFilePath();
    const prevLine = Editor.getCurrentLine();
    if (prevFilePath && prevLine > 0) {
        try {
            await invoke('save_last_position', {
                filePath: prevFilePath,
                position: prevLine
            });
        } catch (err) {
            // non-critical
        }
    }

    // Switch in backend
    try {
        const fileInfo = await invoke('switch_tab', { fileId: fileId });
        if (fileInfo) {
            state.files.set(fileId, fileInfo);
            await Editor.loadFile(fileInfo);
            SearchDialog.setFileId(fileId);
            BookmarkPanel.loadBookmarks(fileInfo.path);
        }
    } catch (err) {
        console.error('Failed to switch tab:', err);
        // Try to load from cached info
        const cachedInfo = state.files.get(fileId);
        if (cachedInfo) {
            await Editor.loadFile(cachedInfo);
            SearchDialog.setFileId(fileId);
            BookmarkPanel.loadBookmarks(cachedInfo.path);
        }
    }

    updateStatusBar();
}

// ============================================================
// Bookmark Operations
// ============================================================

function handleAddBookmark() {
    const fileId = Editor.getCurrentFileId();
    const filePath = Editor.getCurrentFilePath();
    if (!fileId || !filePath) {
        // If no file, toggle panel instead
        BookmarkPanel.togglePanel();
        return;
    }

    const currentLine = Editor.getCurrentLine();
    const dialogEl = document.getElementById('bookmark-add-dialog');
    const infoEl = document.getElementById('bookmark-add-info');
    const memoInput = document.getElementById('bookmark-memo-input');
    const btnConfirm = document.getElementById('btn-bookmark-add-confirm');
    const btnCancel = document.getElementById('btn-bookmark-add-cancel');
    const btnClose = document.getElementById('btn-bookmark-add-close');

    infoEl.textContent = '\uC904: ' + currentLine;
    memoInput.value = '';
    dialogEl.classList.remove('hidden');
    memoInput.focus();

    function doClose() {
        dialogEl.classList.add('hidden');
        cleanup();
    }

    function doConfirm() {
        const memo = memoInput.value.trim();
        BookmarkPanel.addBookmark(currentLine, memo);
        doClose();
    }

    function onKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            doConfirm();
        }
        if (e.key === 'Escape') {
            doClose();
        }
    }

    function onOverlayClick(e) {
        if (e.target === dialogEl) doClose();
    }

    function cleanup() {
        btnConfirm.removeEventListener('click', doConfirm);
        btnCancel.removeEventListener('click', doClose);
        btnClose.removeEventListener('click', doClose);
        memoInput.removeEventListener('keydown', onKeydown);
        dialogEl.removeEventListener('click', onOverlayClick);
    }

    btnConfirm.addEventListener('click', doConfirm);
    btnCancel.addEventListener('click', doClose);
    btnClose.addEventListener('click', doClose);
    memoInput.addEventListener('keydown', onKeydown);
    dialogEl.addEventListener('click', onOverlayClick);
}

// ============================================================
// Edit Mode
// ============================================================

function handleToggleEditMode() {
    const editMode = Editor.toggleEditMode();
    updateEditModeUI(editMode);
}

function updateEditModeUI(editMode) {
    const btn = document.getElementById('btn-edit-mode');
    if (btn) {
        btn.classList.toggle('active', editMode);
        btn.title = editMode ? '뷰어 모드로 전환 (F2)' : '편집 모드로 전환 (F2)';
    }
    const statusMode = document.getElementById('status-mode');
    if (statusMode) {
        statusMode.textContent = editMode ? '편집' : '뷰어';
    }
}

// ============================================================
// Status Bar
// ============================================================

function updateStatusBar() {
    const fileId = Editor.getCurrentFileId();

    if (!fileId) {
        document.getElementById('status-line').textContent = '\uC904: 0 / 0';
        document.getElementById('status-chars').textContent = '\uBB38\uC790: 0';
        document.getElementById('status-encoding').textContent = 'UTF-8';
        document.getElementById('status-modified').textContent = '';
        updateSaveButton(false);
        return;
    }

    const info = state.files.get(fileId);
    if (info) {
        updateStatusLine(Editor.getCurrentLine(), info.total_lines || Editor.getTotalLines());
        document.getElementById('status-chars').textContent = '\uBB38\uC790: ' + (info.total_chars || 0).toLocaleString();
        document.getElementById('status-encoding').textContent = 'UTF-8';
        document.getElementById('status-modified').textContent = info.is_modified ? '\uC218\uC815\uB428' : '';
        updateSaveButton(info.is_modified);
    }
}

function updateSaveButton(isModified) {
    const btn = document.getElementById('btn-save');
    if (!btn) return;
    if (isModified) {
        btn.disabled = false;
        btn.classList.add('has-changes');
        btn.title = '\uC800\uC7A5 (Ctrl+S) - \uC218\uC815\uC0AC\uD56D \uC788\uC74C';
    } else {
        btn.disabled = true;
        btn.classList.remove('has-changes');
        btn.title = '\uC800\uC7A5 (Ctrl+S)';
    }
}

function updateStatusLine(currentLine, totalLines) {
    document.getElementById('status-line').textContent =
        '\uC904: ' + currentLine.toLocaleString() + ' / ' + totalLines.toLocaleString();
}

// ============================================================
// Help Dialog
// ============================================================

function showHelp() {
    // Simple alert-style help for now
    const shortcuts = [
        'Ctrl+O  \uD30C\uC77C \uC5F4\uAE30',
        'Ctrl+S  \uC800\uC7A5',
        'Ctrl+W  \uD0ED \uB2EB\uAE30',
        'Ctrl+F  \uCC3E\uAE30',
        'Ctrl+H  \uBC14\uAFB8\uAE30',
        'Ctrl+Z  \uC2E4\uD589 \uCDE8\uC18C',
        'Ctrl+Y  \uB2E4\uC2DC \uC2E4\uD589',
        'Ctrl+B  \uCC45\uAC08\uD53C \uCD94\uAC00',
        'Ctrl+G  \uC904 \uC774\uB3D9',
        'Ctrl+Tab  \uB2E4\uC74C \uD0ED',
        'Ctrl+Shift+F  \uD14D\uC2A4\uD2B8 \uC815\uB9AC'
    ].join('\n');

    // Using a simple approach since we don't have a dedicated help modal
    console.log('SImpleReader Shortcuts:\n' + shortcuts);
}
