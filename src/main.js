/**
 * SimpleReader - Main Application Entry Point
 * Initializes all components, sets up keyboard shortcuts, and manages app state.
 */

import * as MenuBar from './components/MenuBar.js';
import * as TabBar from './components/TabBar.js';
import * as Editor from './components/Editor.js';
import * as EpubViewer from './components/EpubViewer.js';
import * as PdfViewer from './components/PdfViewer.js';
import * as ImageViewer from './components/ImageViewer.js';
import * as BookmarkPanel from './components/BookmarkPanel.js';
import * as SearchDialog from './components/SearchDialog.js';
import * as SettingsDialog from './components/SettingsDialog.js';
import * as FormatDialog from './components/FormatDialog.js';
import * as GoToLineDialog from './components/GoToLineDialog.js';
import { open as openDialog, ask } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

// ============================================================
// Application State
// ============================================================

const state = {
    files: new Map(), // fileId -> fileInfo
    activeFileId: null
};

let isFullscreen = false;

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
    } catch {
        // 설정 로드 실패시 기본값 사용
    }

    // Initialize all components
    initMenuBar();
    initTabBar();
    initEditor();
    initEpubViewer();
    initPdfViewer();
    initImageViewer();
    initBookmarkPanel();
    initSearchDialog();
    initSettingsDialog();
    initFormatDialog();
    initGoToLineDialog();
    initSidebarResize();
    initKeyboardShortcuts();
    initDragAndDrop();
    initWelcome();

    // Open button
    const btnOpen = document.getElementById('btn-open');
    if (btnOpen) {
        btnOpen.addEventListener('click', handleOpenFile);
    }

    // Save button
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        btnSave.addEventListener('click', handleSave);
    }

    // Sidebar toggle buttons
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const btnReopenSidebar = document.getElementById('btn-reopen-sidebar');
    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => toggleSidebar());
    }
    if (btnReopenSidebar) {
        btnReopenSidebar.addEventListener('click', () => toggleSidebar());
    }

    // Edit mode toggle button
    const btnEditMode = document.getElementById('btn-edit-mode');
    if (btnEditMode) {
        btnEditMode.addEventListener('click', handleToggleEditMode);
    }

    // Fullscreen toggle button
    const btnFullscreen = document.getElementById('btn-fullscreen');
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', toggleFullscreen);
    }

    // 앱 종료 시 현재 위치 저장 후 닫기
    const appWindow = getCurrentWindow();
    appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        const shouldClose = await ask('현재 읽기 위치를 저장하고 종료할까요?', {
            title: 'SimpleReader',
            kind: 'info',
            okLabel: '닫기',
            cancelLabel: '취소'
        });
        if (shouldClose) {
            // 저장 타임아웃 2초 (행 방지)
            await Promise.race([
                saveCurrentPosition(),
                new Promise(resolve => setTimeout(resolve, 2000))
            ]).catch(() => {});
            // Rust 백엔드에서 직접 앱 종료 (destroy()는 권한 문제로 실패)
            await invoke('exit_app');
        }
    });

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

            // 마지막 활성 탭 자동 복원
            const activeTab = tabs.find(t => t.is_active);
            if (activeTab) {
                await openFile(activeTab.path);
            }
        }
    } catch (err) {
        // No open tabs, that is fine
    }

    // Listen for file open from CLI args (file association)
    listen('open-file-from-args', async (event) => {
        const filePath = event.payload;
        if (filePath) {
            await openFile(filePath);
        }
    });
}

function applyConfig(config) {
    if (config.font_size) {
        document.documentElement.style.setProperty('--font-size-editor', config.font_size + 'px');
    }
    if (config.font_family) {
        document.documentElement.style.setProperty('--font-mono', config.font_family);
    }
    if (config.theme && config.theme !== 'dark') {
        document.documentElement.setAttribute('data-theme', config.theme);
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    document.documentElement.style.setProperty('--font-weight-editor', config.font_bold ? 'bold' : 'normal');
    // Line numbers
    const editorContainer = document.getElementById('editor-container');
    if (editorContainer) {
        editorContainer.classList.toggle('hide-line-numbers', config.show_line_numbers === false);
        editorContainer.classList.toggle('word-wrap', config.word_wrap === true);
    }
    updateLineNumbersMenuLabel(config.show_line_numbers !== false);
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

function initEpubViewer() {
    EpubViewer.init({
        onChapterChange: (chapterIndex, totalChapters, chapterTitle) => {
            updateEpubStatusBar(chapterIndex, totalChapters);
        }
    });
}

function initPdfViewer() {
    PdfViewer.init({
        onPageChange: (page, totalPages) => {
            updatePdfStatusBar(page, totalPages);
        }
    });
}

function initImageViewer() {
    ImageViewer.init({
        onImageChange: (index, totalImages) => {
            updateImageStatusBar(index, totalImages);
        }
    });
}

function initBookmarkPanel() {
    BookmarkPanel.init({
        onBookmarkClick: (position, line) => {
            if (ImageViewer.isVisible()) {
                if (line > 0) ImageViewer.navigateToImage(line - 1);
            } else if (PdfViewer.isVisible()) {
                if (line > 0) PdfViewer.navigateToPage(line);
            } else if (EpubViewer.isVisible()) {
                EpubViewer.navigateToChapter(line, position);
            } else {
                if (line > 0) Editor.scrollToLine(line);
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
        },
        onReplace: (fileId) => {
            const info = state.files.get(fileId);
            if (info) info.is_modified = true;
            TabBar.updateTab(fileId, { is_modified: true });
            Editor.refreshContent();
            updateStatusBar();
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
            applyConfig(config);
        }
    });
}

function initFormatDialog() {
    FormatDialog.init({
        onFormatApplied: () => {
            Editor.refreshContent();
            if (state.activeFileId) {
                const info = state.files.get(state.activeFileId);
                if (info) info.is_modified = true;
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
    // Ctrl+A 전체 선택: 클릭 시 해제
    document.addEventListener('mousedown', () => {
        if (window.__allSelected) {
            window.__allSelected = false;
            window.__fullText = null;
            document.getElementById('editor-lines')?.classList.remove('all-selected');
        }
    });

    document.addEventListener('keydown', (e) => {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        // Ctrl+A/C 외의 키 입력 시 전체 선택 해제
        if (window.__allSelected && !(ctrl && (e.key === 'c' || e.key === 'a'))) {
            window.__allSelected = false;
        }

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

        // Ctrl+L: Toggle line numbers
        if (ctrl && !shift && e.key === 'l') {
            e.preventDefault();
            handleToggleLineNumbers();
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
            if (EpubViewer.isVisible() || PdfViewer.isVisible() || ImageViewer.isVisible()) {
                alert('텍스트 정리는 텍스트 파일에서만 사용할 수 있습니다.');
                return;
            }
            const fileId = Editor.getCurrentFileId();
            if (fileId) {
                FormatDialog.show(fileId, Editor.getCurrentFilePath());
            }
            return;
        }

        // Ctrl+A: 전체 선택 (미리 텍스트 캐시 + CSS로 시각적 선택 표시)
        if (ctrl && !shift && e.key === 'a') {
            const fileId = Editor.getCurrentFileId();
            if (fileId) {
                e.preventDefault();
                window.__allSelected = true;
                window.__fullText = null;
                const linesEl = document.getElementById('editor-lines');
                if (linesEl) linesEl.classList.add('all-selected');
                // 백그라운드에서 전체 텍스트를 미리 가져옴
                invoke('get_full_text', { fileId }).then(text => {
                    window.__fullText = text;
                }).catch(() => {});
                return;
            }
        }

        // Ctrl+C: 전체 선택 상태면 캐시된 텍스트를 클립보드에 복사
        if (ctrl && !shift && e.key === 'c') {
            if (window.__allSelected && window.__fullText) {
                e.preventDefault();
                navigator.clipboard.writeText(window.__fullText).catch(() => {});
                return;
            }
        }

        // F2: Toggle edit mode
        if (e.key === 'F2') {
            e.preventDefault();
            handleToggleEditMode();
            return;
        }

        // F11: Toggle fullscreen
        if (e.key === 'F11') {
            e.preventDefault();
            toggleFullscreen();
            return;
        }

        // Escape: Exit fullscreen or close dialogs
        if (e.key === 'Escape') {
            if (isFullscreen) {
                toggleFullscreen();
                return;
            }
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
    } catch {
        // drag-drop 이벤트 미지원 환경
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
            if (EpubViewer.isVisible() || PdfViewer.isVisible() || ImageViewer.isVisible()) {
                alert('텍스트 정리는 텍스트 파일에서만 사용할 수 있습니다.');
                break;
            }
            const fileId = Editor.getCurrentFileId();
            if (fileId) FormatDialog.show(fileId, Editor.getCurrentFilePath());
            break;
        }
        case 'goto-line':
            GoToLineDialog.show(Editor.getCurrentLine(), Editor.getTotalLines());
            break;
        case 'toggle-edit-mode':
            handleToggleEditMode();
            break;
        case 'toggle-line-numbers':
            handleToggleLineNumbers();
            break;
        case 'toggle-bookmark-panel':
            toggleSidebar();
            break;
        case 'toggle-fullscreen':
            toggleFullscreen();
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
            filters: [
                { name: 'Supported Files', extensions: ['txt', 'md', 'log', 'csv', 'json', 'epub', 'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'zip'] },
                { name: 'Text Files', extensions: ['txt', 'md', 'log', 'csv', 'json'] },
                { name: 'EPUB Files', extensions: ['epub'] },
                { name: 'PDF Files', extensions: ['pdf'] },
                { name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] },
                { name: 'ZIP Archives', extensions: ['zip'] }
            ]
        });

        if (filePath) {
            await openFile(filePath);
        }
    } catch {
        // 파일 대화상자 오류
    }
}

async function saveCurrentPosition() {
    if (PdfViewer.isVisible()) {
        const filePath = PdfViewer.getCurrentFilePath();
        if (filePath) {
            try {
                await invoke('save_last_position', {
                    filePath: filePath,
                    position: PdfViewer.getCurrentPage()
                });
            } catch { /* non-critical */ }
        }
    } else if (ImageViewer.isVisible()) {
        const filePath = ImageViewer.getCurrentFilePath();
        if (filePath) {
            try {
                await invoke('save_last_position', {
                    filePath: filePath,
                    position: ImageViewer.getCurrentIndex()
                });
            } catch { /* non-critical */ }
        }
    } else if (EpubViewer.isVisible()) {
        const filePath = EpubViewer.getCurrentFilePath();
        if (filePath) {
            try {
                await invoke('save_last_position', {
                    filePath: filePath,
                    position: EpubViewer.getCurrentChapter(),
                    scrollOffset: EpubViewer.getScrollPosition()
                });
            } catch { /* non-critical */ }
        }
    } else {
        const filePath = Editor.getCurrentFilePath();
        const line = Editor.getCurrentLine();
        if (filePath && line > 0) {
            try {
                await invoke('save_last_position', {
                    filePath: filePath,
                    position: line
                });
            } catch { /* non-critical */ }
        }
    }
}

async function openFile(path) {
    const loadingOverlay = document.getElementById('editor-loading-overlay');
    let loadingTimer = null;
    try {
        // 이전 파일 위치 저장
        await saveCurrentPosition();

        // 500ms 이상 걸리면 로딩 스피너 표시
        loadingTimer = setTimeout(() => {
            loadingOverlay.classList.remove('hidden');
            loadingTimer = null;
        }, 500);

        const fileInfo = await invoke('open_file', { path: path });

        clearTimeout(loadingTimer);
        loadingOverlay.classList.add('hidden');

        state.files.set(fileInfo.id, fileInfo);
        state.activeFileId = fileInfo.id;

        TabBar.addTab(fileInfo);

        if (fileInfo.file_type === 'epub') {
            Editor.clear();
            PdfViewer.hide();
            ImageViewer.hide();
            document.getElementById('editor-container').classList.add('hidden');
            await EpubViewer.loadFile(fileInfo);
            updateEpubStatusBar(fileInfo.last_position || 0, fileInfo.total_chapters);
        } else if (fileInfo.file_type === 'pdf') {
            Editor.clear();
            EpubViewer.hide();
            ImageViewer.hide();
            document.getElementById('editor-container').classList.add('hidden');
            await PdfViewer.loadFile(fileInfo);
            updatePdfStatusBar(fileInfo.last_position || 1, 0);
        } else if (fileInfo.file_type === 'image') {
            Editor.clear();
            EpubViewer.hide();
            PdfViewer.hide();
            document.getElementById('editor-container').classList.add('hidden');
            await ImageViewer.loadFile(fileInfo);
            updateImageStatusBar(fileInfo.last_position || 0, fileInfo.total_images || 0);
        } else {
            EpubViewer.hide();
            PdfViewer.hide();
            ImageViewer.hide();
            document.getElementById('editor-container').classList.remove('hidden');
            await Editor.loadFile(fileInfo);
            SearchDialog.setFileId(fileInfo.id);

            // 저장된 텍스트 정리 옵션이 있으면 자동 적용
            try {
                const savedFormat = await invoke('get_format_type', { filePath: fileInfo.path });
                if (savedFormat) {
                    await invoke('apply_format', {
                        fileId: fileInfo.id,
                        formatType: savedFormat
                    });
                    await Editor.refreshContent();
                }
            } catch { /* non-critical */ }
        }

        BookmarkPanel.loadBookmarks(fileInfo.path, fileInfo.file_type);

        // Track file open for file list
        try {
            await invoke('track_file_open', { filePath: fileInfo.path });
            BookmarkPanel.refreshFileList();
        } catch (e) {
            // non-critical
        }

        updateStatusBar();
        updateViewerUI(fileInfo.file_type);
    } catch {
        clearTimeout(loadingTimer);
        loadingOverlay.classList.add('hidden');
        const shouldRemove = confirm('파일을 찾을 수 없습니다.\n목록에서 삭제하시겠습니까?\n\n' + path);
        if (shouldRemove) {
            try {
                await invoke('remove_file_entry', { filePath: path });
                BookmarkPanel.refreshFileList();
            } catch {
                // 파일 항목 삭제 실패
            }
        }
    }
}

async function handleSave() {
    // EPUB/PDF files are read-only
    if (EpubViewer.isVisible() || PdfViewer.isVisible() || ImageViewer.isVisible()) return;

    const fileId = Editor.getCurrentFileId();
    if (!fileId) return;

    try {
        await invoke('save_file', { fileId: fileId });
        const info = state.files.get(fileId);
        if (info) info.is_modified = false;
        TabBar.updateTab(fileId, { is_modified: false });
        updateStatusBar();
    } catch {
        // 저장 실패
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
    } catch {
        // 탭 닫기 오류
    }

    state.files.delete(fileId);
    TabBar.removeTab(fileId);

    const newActiveId = TabBar.getActiveTabId();
    if (!newActiveId) {
        state.activeFileId = null;
        Editor.clear();
        EpubViewer.clear();
        PdfViewer.clear();
        ImageViewer.clear();
        document.getElementById('editor-container').classList.remove('hidden');
        SearchDialog.setFileId(null);
        updateStatusBar();
        updateViewerUI('text');
    }
}

async function handleTabSwitch(fileId) {
    if (!fileId) {
        state.activeFileId = null;
        Editor.clear();
        EpubViewer.clear();
        PdfViewer.clear();
        ImageViewer.clear();
        document.getElementById('editor-container').classList.remove('hidden');
        updateStatusBar();
        updateViewerUI('text');
        return;
    }

    // 이전 파일 위치 저장
    await saveCurrentPosition();

    state.activeFileId = fileId;

    // Switch in backend
    try {
        const fileInfo = await invoke('switch_tab', { fileId: fileId });
        if (fileInfo) {
            state.files.set(fileId, fileInfo);
            await showFileByType(fileInfo, fileId);

            // 파일 목록 순서 갱신
            try {
                await invoke('track_file_open', { filePath: fileInfo.path });
                BookmarkPanel.refreshFileList();
            } catch { /* non-critical */ }
        }
    } catch {
        const cachedInfo = state.files.get(fileId);
        if (cachedInfo) {
            await showFileByType(cachedInfo, fileId);
        }
    }

    updateStatusBar();
}

async function showFileByType(fileInfo, fileId) {
    if (fileInfo.file_type === 'epub') {
        Editor.clear();
        PdfViewer.hide();
        ImageViewer.hide();
        document.getElementById('editor-container').classList.add('hidden');
        await EpubViewer.loadFile(fileInfo);
        updateEpubStatusBar(fileInfo.last_position || 0, fileInfo.total_chapters);
    } else if (fileInfo.file_type === 'pdf') {
        Editor.clear();
        EpubViewer.hide();
        ImageViewer.hide();
        document.getElementById('editor-container').classList.add('hidden');
        await PdfViewer.loadFile(fileInfo);
    } else if (fileInfo.file_type === 'image') {
        Editor.clear();
        EpubViewer.hide();
        PdfViewer.hide();
        document.getElementById('editor-container').classList.add('hidden');
        await ImageViewer.loadFile(fileInfo);
        updateImageStatusBar(fileInfo.last_position || 0, fileInfo.total_images || 0);
    } else {
        EpubViewer.hide();
        PdfViewer.hide();
        ImageViewer.hide();
        document.getElementById('editor-container').classList.remove('hidden');
        await Editor.loadFile(fileInfo);
        SearchDialog.setFileId(fileId);

        // 저장된 텍스트 정리 옵션이 있으면 자동 적용
        try {
            const savedFormat = await invoke('get_format_type', { filePath: fileInfo.path });
            if (savedFormat) {
                await invoke('apply_format', {
                    fileId: fileInfo.id,
                    formatType: savedFormat
                });
                await Editor.refreshContent();
            }
        } catch { /* non-critical */ }
    }

    BookmarkPanel.loadBookmarks(fileInfo.path, fileInfo.file_type);
    updateViewerUI(fileInfo.file_type);
}

// ============================================================
// Bookmark Operations
// ============================================================

function handleAddBookmark() {
    const isImage = ImageViewer.isVisible();
    const isEpub = EpubViewer.isVisible();
    const isPdf = PdfViewer.isVisible();
    const fileId = isImage ? ImageViewer.getCurrentFileId()
        : isEpub ? EpubViewer.getCurrentFileId()
        : isPdf ? PdfViewer.getCurrentFileId()
        : Editor.getCurrentFileId();
    const filePath = isImage ? ImageViewer.getCurrentFilePath()
        : isEpub ? EpubViewer.getCurrentFilePath()
        : isPdf ? PdfViewer.getCurrentFilePath()
        : Editor.getCurrentFilePath();
    if (!fileId || !filePath) {
        BookmarkPanel.togglePanel();
        return;
    }

    const currentLine = isImage ? (ImageViewer.getCurrentIndex() + 1)
        : isEpub ? EpubViewer.getCurrentChapter()
        : isPdf ? PdfViewer.getCurrentPage()
        : Editor.getCurrentLine();
    // EPUB: position = 스크롤 위치, line = 챕터 인덱스 / 나머지: position = line
    const scrollPos = isEpub ? EpubViewer.getScrollPosition() : currentLine;
    const dialogEl = document.getElementById('bookmark-add-dialog');
    const infoEl = document.getElementById('bookmark-add-info');
    const memoInput = document.getElementById('bookmark-memo-input');
    const btnConfirm = document.getElementById('btn-bookmark-add-confirm');
    const btnCancel = document.getElementById('btn-bookmark-add-cancel');
    const btnClose = document.getElementById('btn-bookmark-add-close');

    if (isImage) {
        infoEl.textContent = '이미지 ' + currentLine + ' / ' + ImageViewer.getTotalImages();
    } else if (isEpub) {
        infoEl.textContent = '챕터 ' + (currentLine + 1) + ' / ' + EpubViewer.getTotalChapters();
    } else if (isPdf) {
        infoEl.textContent = '페이지 ' + currentLine + ' / ' + PdfViewer.getTotalPages();
    } else {
        infoEl.textContent = '줄 ' + currentLine + ' / ' + Editor.getTotalLines();
    }
    memoInput.value = '';
    dialogEl.classList.remove('hidden');
    memoInput.focus();

    function doClose() {
        dialogEl.classList.add('hidden');
        cleanup();
    }

    function doConfirm() {
        const memo = memoInput.value.trim();
        BookmarkPanel.addBookmark(scrollPos, currentLine, memo);
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
    // Disable edit mode for EPUB/PDF files
    if (EpubViewer.isVisible() || PdfViewer.isVisible() || ImageViewer.isVisible()) return;
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
// Sidebar Toggle
// ============================================================

function toggleSidebar() {
    // 사이드바 토글 시 맨 윗줄 기준으로 위치 보존
    // transition 동안 resize→scheduleRender 체인을 차단하고, 끝난 후 한 번만 복원
    const topLine = Editor.getFirstVisibleLine();

    Editor.suppressRender(true);
    BookmarkPanel.togglePanel();

    const panel = document.getElementById('bookmark-panel');
    let restored = false;

    function doRestore() {
        if (restored) return;
        restored = true;
        panel.removeEventListener('transitionend', onTransitionEnd);
        Editor.suppressRender(false);
        if (topLine > 0) {
            Editor.recalculateAndScrollTo(topLine);
        }
    }

    function onTransitionEnd(e) {
        if (e.propertyName === 'width') doRestore();
    }

    panel.addEventListener('transitionend', onTransitionEnd);
    setTimeout(doRestore, 400); // 안전장치: transitionend가 안 오면 강제 복원

    const reopenBtn = document.getElementById('btn-reopen-sidebar');
    if (reopenBtn) {
        reopenBtn.classList.toggle('hidden', !BookmarkPanel.isCollapsed());
    }
}

// ============================================================
// Fullscreen Toggle
// ============================================================

async function toggleFullscreen() {
    const appWindow = getCurrentWindow();
    isFullscreen = !isFullscreen;
    await appWindow.setFullscreen(isFullscreen);
    document.body.classList.toggle('fullscreen-mode', isFullscreen);

    // 전체화면 메뉴 텍스트 업데이트
    const menuItem = document.querySelector('[data-action="toggle-fullscreen"] span:first-child');
    if (menuItem) {
        menuItem.textContent = isFullscreen ? '전체 화면 해제' : '전체 화면';
    }
}

// ============================================================
// Line Numbers Toggle
// ============================================================

let lineNumbersVisible = true;

function updateLineNumbersMenuLabel(visible) {
    lineNumbersVisible = visible;
    const menuItem = document.getElementById('menu-toggle-line-numbers');
    if (menuItem) {
        const label = menuItem.querySelector('span:first-child');
        if (label) {
            label.textContent = visible ? '\u2713 \uC904 \uBC88\uD638 \uD45C\uC2DC' : '\uC904 \uBC88\uD638 \uD45C\uC2DC';
        }
    }
}

async function handleToggleLineNumbers() {
    lineNumbersVisible = !lineNumbersVisible;
    const editorContainer = document.getElementById('editor-container');
    if (editorContainer) {
        editorContainer.classList.toggle('hide-line-numbers', !lineNumbersVisible);
    }
    updateLineNumbersMenuLabel(lineNumbersVisible);
    // Save to config
    try {
        const config = await invoke('get_config');
        config.show_line_numbers = lineNumbersVisible;
        await invoke('save_config', { config });
    } catch {
        // 줄번호 설정 저장 실패
    }
}

// ============================================================
// Status Bar
// ============================================================

/**
 * Update UI elements when switching between viewer modes.
 * Disables edit/save buttons for EPUB/PDF files.
 */
function updateViewerUI(fileType) {
    const isReadOnly = fileType === 'epub' || fileType === 'pdf' || fileType === 'image';
    const btnSave = document.getElementById('btn-save');
    const btnEditMode = document.getElementById('btn-edit-mode');
    if (btnSave) {
        if (isReadOnly) {
            btnSave.disabled = true;
            btnSave.classList.remove('has-changes');
        }
    }
    if (btnEditMode) {
        btnEditMode.disabled = isReadOnly;
        if (isReadOnly) {
            btnEditMode.classList.remove('active');
        }
    }
    const statusMode = document.getElementById('status-mode');
    if (statusMode) {
        if (fileType === 'epub') {
            statusMode.textContent = 'EPUB';
        } else if (fileType === 'pdf') {
            statusMode.textContent = 'PDF';
        } else if (fileType === 'image') {
            statusMode.textContent = '이미지';
        } else {
            statusMode.textContent = Editor.isEditMode() ? '편집' : '뷰어';
        }
    }
}

function updateEpubStatusBar(chapterIndex, totalChapters) {
    const percent = totalChapters > 0
        ? ((chapterIndex + 1) / totalChapters * 100).toFixed(1)
        : '0.0';
    document.getElementById('status-line').textContent =
        '챕터: ' + (chapterIndex + 1) + ' / ' + totalChapters + ' (' + percent + ' %)';
    document.getElementById('status-chars').textContent = '';
    document.getElementById('status-encoding').textContent = 'EPUB';
    document.getElementById('status-modified').textContent = '';
}

function updatePdfStatusBar(page, totalPages) {
    const percent = totalPages > 0
        ? (page / totalPages * 100).toFixed(1)
        : '0.0';
    document.getElementById('status-line').textContent =
        '\uD398\uC774\uC9C0: ' + page + ' / ' + totalPages + ' (' + percent + ' %)';
    document.getElementById('status-chars').textContent = '';
    document.getElementById('status-encoding').textContent = 'PDF';
    document.getElementById('status-modified').textContent = '';
}

function updateImageStatusBar(index, totalImages) {
    const percent = totalImages > 0
        ? ((index + 1) / totalImages * 100).toFixed(1)
        : '0.0';
    document.getElementById('status-line').textContent =
        '이미지: ' + (index + 1) + ' / ' + totalImages + ' (' + percent + ' %)';
    document.getElementById('status-chars').textContent = '';
    document.getElementById('status-encoding').textContent = '이미지';
    document.getElementById('status-modified').textContent = '';
}

function updateStatusBar() {
    if (EpubViewer.isVisible()) {
        updateEpubStatusBar(EpubViewer.getCurrentChapter(), EpubViewer.getTotalChapters());
        return;
    }
    if (PdfViewer.isVisible()) {
        updatePdfStatusBar(PdfViewer.getCurrentPage(), PdfViewer.getTotalPages());
        return;
    }
    if (ImageViewer.isVisible()) {
        updateImageStatusBar(ImageViewer.getCurrentIndex(), ImageViewer.getTotalImages());
        return;
    }

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
    const rawPercent = totalLines > 0 ? (currentLine / totalLines * 100) : 0;
    const percent = currentLine >= totalLines ? '100.0' : (Math.floor(rawPercent * 10) / 10).toFixed(1);
    document.getElementById('status-line').textContent =
        '\uC904: ' + currentLine.toLocaleString() + ' / ' + totalLines.toLocaleString() + ' (' + percent + ' %)';
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

    alert(shortcuts);
}
