/**
 * Editor - Core text editor with virtual scrolling
 * Handles large files (500k+ lines) via chunk-based rendering
 */

import { invoke } from '@tauri-apps/api/core';

// State
let currentFileId = null;
let currentFilePath = null;
let totalLines = 0;
let lineHeight = 24;
let renderedStartLine = -1;
let renderedEndLine = -1;
let currentLine = 0;
let isEditing = false;
let editingLineIndex = -1;
let searchMatches = [];
let activeMatchIndex = -1;
let cachedChunks = new Map();
let scrollRAF = null;
let renderGeneration = 0;
let onModified = null;
let onLineChange = null;
let onEditModeChange = null;
let editMode = false;
let pendingScrollToMatch = false;
let suppressScrollRender = false;

// DOM elements
const container = document.getElementById('editor-container');
const scrollArea = document.getElementById('editor-scroll-area');
const linesContainer = document.getElementById('editor-lines');
const spacerTop = document.getElementById('editor-spacer-top');
const spacerBottom = document.getElementById('editor-spacer-bottom');
const welcome = document.getElementById('editor-welcome');

// Buffer lines above and below viewport
const BUFFER_LINES = 50;
// Maximum virtual scroll height to avoid browser CSS height limits (~33M px)
const MAX_SCROLL_HEIGHT = 15_000_000;

export function init(options = {}) {
    onModified = options.onModified || null;
    onLineChange = options.onLineChange || null;
    onEditModeChange = options.onEditModeChange || null;

    scrollArea.addEventListener('scroll', onScroll, { passive: true });

    calculateLineHeight();

    window.addEventListener('resize', () => {
        calculateLineHeight();
        if (currentFileId) {
            scheduleRender();
        }
    });
}

function calculateLineHeight() {
    const testEl = document.createElement('div');
    testEl.className = 'editor-line';
    const numSpan = document.createElement('span');
    numSpan.className = 'line-number';
    numSpan.textContent = '1';
    const contentSpan = document.createElement('span');
    contentSpan.className = 'line-content';
    contentSpan.textContent = 'X';
    testEl.style.visibility = 'hidden';
    testEl.style.position = 'absolute';
    testEl.appendChild(numSpan);
    testEl.appendChild(contentSpan);
    linesContainer.appendChild(testEl);

    const computedStyle = getComputedStyle(document.documentElement);
    const fontSize = parseFloat(computedStyle.getPropertyValue('--font-size-editor')) || 16;
    const lineHeightRatio = parseFloat(computedStyle.getPropertyValue('--line-height-editor')) || 1.5;
    lineHeight = Math.ceil(fontSize * lineHeightRatio);

    const measured = testEl.getBoundingClientRect().height;
    if (measured > 0) {
        lineHeight = Math.ceil(measured);
    }

    linesContainer.removeChild(testEl);
}

export async function loadFile(fileInfo) {
    currentFileId = fileInfo.id;
    currentFilePath = fileInfo.path;
    totalLines = fileInfo.total_lines || 0;
    currentLine = fileInfo.last_position || 0;
    renderedStartLine = -1;
    renderedEndLine = -1;
    cachedChunks.clear();
    searchMatches = [];
    activeMatchIndex = -1;

    welcome.classList.add('hidden');
    scrollArea.classList.remove('hidden');

    updateScrollHeight();

    if (currentLine > 0) {
        scrollArea.scrollTop = currentLine * lineHeight * getScrollRatio();
    } else {
        scrollArea.scrollTop = 0;
    }

    renderGeneration++;
    await renderVisibleLines(true);
}

export function clear() {
    currentFileId = null;
    currentFilePath = null;
    totalLines = 0;
    currentLine = 0;
    renderedStartLine = -1;
    renderedEndLine = -1;
    cachedChunks.clear();
    searchMatches = [];
    activeMatchIndex = -1;

    while (linesContainer.firstChild) {
        linesContainer.removeChild(linesContainer.firstChild);
    }
    scrollArea.classList.add('hidden');
    welcome.classList.remove('hidden');
}

export function getCurrentFileId() {
    return currentFileId;
}

export function getCurrentFilePath() {
    return currentFilePath;
}

export function getCurrentLine() {
    // 스크롤 위치에서 직접 계산 (뷰포트 중앙 기준)
    if (!currentFileId || totalLines === 0) return currentLine;
    const scrollTop = scrollArea.scrollTop;
    const viewportHeight = scrollArea.clientHeight;
    const ratio = getScrollRatio();
    const centerLine = Math.floor((scrollTop + viewportHeight / 2) / (lineHeight * ratio)) + 1;
    return Math.max(1, Math.min(centerLine, totalLines));
}

export function getTotalLines() {
    return totalLines;
}

function getScrollRatio() {
    const naturalHeight = totalLines * lineHeight;
    if (naturalHeight <= MAX_SCROLL_HEIGHT) return 1;
    return MAX_SCROLL_HEIGHT / naturalHeight;
}

function updateScrollHeight() {
    const naturalHeight = totalLines * lineHeight;
    const virtualHeight = Math.min(naturalHeight, MAX_SCROLL_HEIGHT);
    spacerTop.style.height = '0px';
    spacerBottom.style.height = virtualHeight + 'px';
}

function onScroll() {
    if (suppressScrollRender) {
        suppressScrollRender = false;
        return;
    }
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(async () => {
        scrollRAF = null;
        await renderVisibleLines();
    });
}

function scheduleRender() {
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    renderGeneration++; // Invalidate any in-flight async renders immediately
    scrollRAF = requestAnimationFrame(async () => {
        scrollRAF = null;
        await renderVisibleLines(true);
    });
}

async function renderVisibleLines(force = false) {
    if (!currentFileId || totalLines === 0) return;

    const thisGeneration = renderGeneration;
    const scrollTop = scrollArea.scrollTop;
    const viewportHeight = scrollArea.clientHeight;
    const ratio = getScrollRatio();

    const firstVisible = Math.floor(scrollTop / (lineHeight * ratio));
    const visibleCount = Math.ceil(viewportHeight / lineHeight);

    const startLine = Math.max(0, firstVisible - BUFFER_LINES);
    const endLine = Math.min(totalLines, firstVisible + visibleCount + BUFFER_LINES);

    const newCurrentLine = firstVisible + 1;
    if (newCurrentLine !== currentLine) {
        currentLine = newCurrentLine;
        if (onLineChange) onLineChange(currentLine, totalLines);
    }

    if (!force && startLine >= renderedStartLine && endLine <= renderedEndLine) {
        return;
    }

    try {
        const chunk = await getChunk(startLine, endLine);
        if (!chunk) return;

        // If a newer render was triggered while we were fetching, skip this stale update
        if (thisGeneration !== renderGeneration) return;

        spacerTop.style.height = (startLine * lineHeight * ratio) + 'px';
        spacerBottom.style.height = (Math.max(0, totalLines - endLine) * lineHeight * ratio) + 'px';

        renderLines(chunk.lines, startLine);

        renderedStartLine = startLine;
        renderedEndLine = endLine;

        // 검색 결과 스크롤 보정: 줄 바꿈(wrapping)으로 인한 위치 오차 보정
        // 렌더링 후 실제 DOM 위치 기반으로 정확히 중앙 정렬하고,
        // 보정으로 인한 재렌더링을 1회 억제하여 위치 안정성 확보
        if (pendingScrollToMatch) {
            pendingScrollToMatch = false;
            const activeEl = linesContainer.querySelector('.search-match-active');
            if (activeEl) {
                const elRect = activeEl.getBoundingClientRect();
                const scrollRect = scrollArea.getBoundingClientRect();
                const offset = (elRect.top + elRect.height / 2) - (scrollRect.top + scrollRect.height / 2);
                if (Math.abs(offset) > 2) {
                    suppressScrollRender = true;
                    scrollArea.scrollTop += offset;
                }
            }
        }
    } catch {
        // 렌더링 실패
    }
}

async function getChunk(startLine, endLine) {
    const cacheKey = startLine + '-' + endLine;
    if (cachedChunks.has(cacheKey)) {
        return cachedChunks.get(cacheKey);
    }

    try {
        const chunk = await invoke('get_text_chunk', {
            fileId: currentFileId,
            startLine: startLine,
            endLine: endLine
        });

        if (cachedChunks.size > 10) {
            const firstKey = cachedChunks.keys().next().value;
            cachedChunks.delete(firstKey);
        }
        cachedChunks.set(cacheKey, chunk);

        return chunk;
    } catch {
        return null;
    }
}

function renderLines(lines, startLine) {
    const fragment = document.createDocumentFragment();

    // Build a set of lines that have search matches for quick lookup
    const matchesByLine = new Map();
    searchMatches.forEach((m, idx) => {
        if (!matchesByLine.has(m.line)) {
            matchesByLine.set(m.line, []);
        }
        matchesByLine.get(m.line).push({ match: m, globalIdx: idx });
    });

    const activeMatchLine = (activeMatchIndex >= 0 && searchMatches[activeMatchIndex])
        ? searchMatches[activeMatchIndex].line : -1;

    for (let i = 0; i < lines.length; i++) {
        const lineNum = startLine + i + 1; // 1-based
        const lineIdx = startLine + i;
        const lineEl = document.createElement('div');
        lineEl.className = 'editor-line';

        if (lineNum === currentLine) {
            lineEl.classList.add('current-line');
        }
        if (matchesByLine.has(lineIdx)) {
            lineEl.classList.add('search-match');
            if (lineIdx === activeMatchLine) {
                lineEl.classList.add('search-match-active');
            }
        }

        const numEl = document.createElement('span');
        numEl.className = 'line-number';
        numEl.textContent = lineNum;

        const contentEl = document.createElement('span');
        contentEl.className = 'line-content';

        // If this line has search matches, render with highlights using safe DOM methods
        const lineMatches = matchesByLine.get(lineIdx);
        if (lineMatches && lineMatches.length > 0) {
            buildHighlightedContent(contentEl, lines[i], lineMatches);
        } else {
            contentEl.textContent = lines[i];
        }

        // Make line editable on double click (always) or single click (edit mode)
        const lineText = lines[i];
        contentEl.addEventListener('dblclick', () => {
            startLineEdit(contentEl, lineIdx, lineText);
        });
        contentEl.addEventListener('click', () => {
            if (editMode) {
                startLineEdit(contentEl, lineIdx, lineText);
            }
        });

        lineEl.appendChild(numEl);
        lineEl.appendChild(contentEl);
        fragment.appendChild(lineEl);
    }

    while (linesContainer.firstChild) {
        linesContainer.removeChild(linesContainer.firstChild);
    }
    linesContainer.appendChild(fragment);
}

function buildHighlightedContent(container, text, lineMatches) {
    // Sort matches by line-relative position
    lineMatches.sort((a, b) => a.match.line_char_start - b.match.line_char_start);

    let lastEnd = 0;

    for (const { match, globalIdx } of lineMatches) {
        // Text before this match
        if (match.line_char_start > lastEnd) {
            container.appendChild(document.createTextNode(text.substring(lastEnd, match.line_char_start)));
        }

        // The match itself as a <mark> element
        const mark = document.createElement('mark');
        if (globalIdx === activeMatchIndex) {
            mark.className = 'active';
        }
        mark.textContent = text.substring(match.line_char_start, match.line_char_end);
        container.appendChild(mark);

        lastEnd = match.line_char_end;
    }

    // Remaining text after last match
    if (lastEnd < text.length) {
        container.appendChild(document.createTextNode(text.substring(lastEnd)));
    }
}

function startLineEdit(contentEl, lineIndex, originalText) {
    if (isEditing) return;

    isEditing = true;
    editingLineIndex = lineIndex;

    contentEl.classList.add('editing');
    contentEl.contentEditable = 'true';
    contentEl.textContent = originalText;
    contentEl.focus();

    const finishEdit = async () => {
        contentEl.contentEditable = 'false';
        contentEl.classList.remove('editing');
        isEditing = false;

        const newText = contentEl.textContent;
        if (newText !== originalText) {
            try {
                await invoke('replace_line', {
                    fileId: currentFileId,
                    lineIndex: lineIndex,
                    newText: newText
                });

                cachedChunks.clear();
                if (onModified) onModified(currentFileId);
                scheduleRender();
            } catch {
                contentEl.textContent = originalText;
            }
        }

        editingLineIndex = -1;
    };

    contentEl.addEventListener('blur', finishEdit, { once: true });
    contentEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            contentEl.blur();
        }
        if (e.key === 'Escape') {
            contentEl.textContent = originalText;
            contentEl.blur();
        }
    });
}

export function setSearchMatches(matches, activeIndex = -1) {
    searchMatches = matches || [];
    activeMatchIndex = activeIndex;
    cachedChunks.clear();
    scheduleRender();
}

export function setActiveMatch(index) {
    activeMatchIndex = index;
    if (index >= 0 && index < searchMatches.length) {
        const match = searchMatches[index];
        scrollToLine(match.line + 1);
        pendingScrollToMatch = true;
    }
    cachedChunks.clear();
    scheduleRender();
}

export function clearSearchHighlights() {
    searchMatches = [];
    activeMatchIndex = -1;
    // 재렌더링 없이 DOM에서 하이라이트만 직접 제거 (스크롤 위치 유지)
    linesContainer.querySelectorAll('.search-match').forEach(el => {
        el.classList.remove('search-match', 'search-match-active');
    });
    linesContainer.querySelectorAll('mark').forEach(mark => {
        mark.replaceWith(mark.textContent);
    });
    cachedChunks.clear();
}

export function scrollToLine(lineNumber) {
    if (lineNumber < 1 || lineNumber > totalLines) return;
    const ratio = getScrollRatio();
    const targetScroll = (lineNumber - 1) * lineHeight * ratio;
    const viewportHeight = scrollArea.clientHeight;
    const newScrollTop = targetScroll - (viewportHeight / 2) + (lineHeight / 2);
    scrollArea.scrollTop = newScrollTop;
    currentLine = lineNumber;
    if (onLineChange) onLineChange(currentLine, totalLines);
}

export async function refreshContent() {
    if (!currentFileId) return;

    try {
        const lines = await invoke('get_total_lines', { fileId: currentFileId });
        totalLines = lines;
        updateScrollHeight();
        cachedChunks.clear();
        renderGeneration++;
        await renderVisibleLines(true);
    } catch {
        // 새로고침 실패
    }
}

export function toggleEditMode() {
    editMode = !editMode;
    container.classList.toggle('edit-mode', editMode);
    if (onEditModeChange) onEditModeChange(editMode);
    return editMode;
}

export function isEditMode() {
    return editMode;
}

export function updateFontSize(size) {
    document.documentElement.style.setProperty('--font-size-editor', size + 'px');
    calculateLineHeight();
    updateScrollHeight();
    cachedChunks.clear();
    scheduleRender();
}

export function updateFontFamily(family) {
    document.documentElement.style.setProperty('--font-mono', family);
    calculateLineHeight();
    updateScrollHeight();
    cachedChunks.clear();
    scheduleRender();
}

export async function undo() {
    if (!currentFileId) return;
    try {
        await invoke('undo', { fileId: currentFileId });
        cachedChunks.clear();
        await refreshContent();
        if (onModified) onModified(currentFileId);
    } catch {
        // Undo 실패
    }
}

export async function redo() {
    if (!currentFileId) return;
    try {
        await invoke('redo', { fileId: currentFileId });
        cachedChunks.clear();
        await refreshContent();
        if (onModified) onModified(currentFileId);
    } catch {
        // Redo 실패
    }
}
