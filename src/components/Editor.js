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
let isRendering = false;
let pendingRender = false;
let renderSuppressed = false;

// DOM elements
const container = document.getElementById('editor-container');
const scrollArea = document.getElementById('editor-scroll-area');
const linesContainer = document.getElementById('editor-lines');
const spacerTop = document.getElementById('editor-spacer-top');
const spacerBottom = document.getElementById('editor-spacer-bottom');
const welcome = document.getElementById('editor-welcome');

// Buffer lines above and below viewport
const BUFFER_LINES = 150;
// Chunk alignment size (cache hit 향상)
const CHUNK_ALIGN = 100;
// 렌더 범위 가장자리 접근 시 재렌더 트리거 마진
const RERENDER_MARGIN = 50;
// Maximum virtual scroll height to avoid browser CSS height limits (~33M px)
const MAX_SCROLL_HEIGHT = 15_000_000;
// 스크롤 방향 추적
let lastScrollTop = 0;

export function init(options = {}) {
    onModified = options.onModified || null;
    onLineChange = options.onLineChange || null;
    onEditModeChange = options.onEditModeChange || null;

    scrollArea.addEventListener('scroll', onScroll, { passive: true });

    calculateLineHeight();

    window.addEventListener('resize', () => {
        if (renderSuppressed) return;
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
    void scrollArea.offsetHeight; // 리플로우 강제 (display:none → visible 전환 시 scrollHeight 확정)
    await new Promise(r => requestAnimationFrame(r)); // DOM 안정화 대기

    // 저장된 위치가 있으면 scrollToLine으로 정확히 이동 (책갈피 클릭과 완전히 동일)
    // 없으면 처음부터 렌더
    renderGeneration++;
    if (currentLine > 0) {
        await scrollToLine(currentLine);
    } else {
        scrollArea.scrollTop = 0;
        await renderVisibleLines(true);
    }
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
    // DOM 기반: 뷰포트 중앙에 보이는 실제 줄을 찾음 (word wrap 대응)
    if (!currentFileId || totalLines === 0) return currentLine;

    const scrollRect = scrollArea.getBoundingClientRect();
    const centerY = scrollRect.top + scrollRect.height / 2;
    const children = linesContainer.children;
    for (let i = 0; i < children.length; i++) {
        const rect = children[i].getBoundingClientRect();
        if (rect.bottom > centerY) {
            return Math.max(1, Math.min(renderedStartLine + i + 1, totalLines));
        }
    }

    // 폴백: 이론적 계산
    const ratio = getScrollRatio();
    const centerLine = Math.floor((scrollArea.scrollTop + scrollArea.clientHeight / 2) / (lineHeight * ratio)) + 1;
    return Math.max(1, Math.min(centerLine, totalLines));
}

export function getFirstVisibleLine() {
    if (!currentFileId || totalLines === 0) return 1;

    // DOM 기반: 실제 뷰포트 맨 위에 보이는 줄을 찾음 (word wrap 대응)
    const scrollRect = scrollArea.getBoundingClientRect();
    const children = linesContainer.children;
    for (let i = 0; i < children.length; i++) {
        const rect = children[i].getBoundingClientRect();
        if (rect.bottom > scrollRect.top) {
            return renderedStartLine + i + 1; // 1-based
        }
    }

    // 폴백: 이론적 계산
    const ratio = getScrollRatio();
    const line = Math.floor(scrollArea.scrollTop / (lineHeight * ratio)) + 1;
    return Math.max(1, Math.min(line, totalLines));
}

export function scrollToLineTop(lineNumber) {
    if (lineNumber < 1 || lineNumber > totalLines) return;
    const ratio = getScrollRatio();
    scrollArea.scrollTop = (lineNumber - 1) * lineHeight * ratio;
}

export function suppressRender(suppress) {
    renderSuppressed = suppress;
}

export async function recalculateAndScrollTo(lineNumber) {
    calculateLineHeight();
    updateScrollHeight();

    // 1단계: 이론적 위치로 이동
    const ratio = getScrollRatio();
    scrollArea.scrollTop = (lineNumber - 1) * lineHeight * ratio;
    renderGeneration++;
    await renderVisibleLines(true);

    // 2단계: 모든 pending 렌더 소화 대기 (2프레임)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // 3단계: DOM 기반 정확한 위치 보정 (상단 고정)
    const targetIdx = lineNumber - 1 - renderedStartLine;
    if (targetIdx >= 0 && targetIdx < linesContainer.children.length) {
        const lineEl = linesContainer.children[targetIdx];
        const lineRect = lineEl.getBoundingClientRect();
        const scrollRect = scrollArea.getBoundingClientRect();
        const offset = lineRect.top - scrollRect.top;
        if (Math.abs(offset) > 1) {
            scrollArea.scrollTop += offset;
        }
    }
    lastScrollTop = scrollArea.scrollTop;
    if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
    pendingRender = false;
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
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(async () => {
        scrollRAF = null;
        await renderVisibleLines();
    });
}

function scheduleRender() {
    if (renderSuppressed) return;
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    renderGeneration++; // Invalidate any in-flight async renders immediately
    scrollRAF = requestAnimationFrame(async () => {
        scrollRAF = null;
        await renderVisibleLines(true);
    });
}

async function renderVisibleLines(force = false) {
    if (!currentFileId || totalLines === 0) return;

    // 렌더링 동시 실행 방지: 이전 렌더가 진행 중이면 완료 후 재시도
    if (isRendering) {
        pendingRender = true;
        return;
    }
    isRendering = true;

    try {
        const thisGeneration = renderGeneration;
        const scrollTop = scrollArea.scrollTop;
        const viewportHeight = scrollArea.clientHeight;
        const ratio = getScrollRatio();

        let firstVisible = Math.floor(scrollTop / (lineHeight * ratio)); // 이론적 폴백
        const visibleCount = Math.ceil(viewportHeight / lineHeight);

        // DOM 기반 firstVisible: 일반 스크롤 시에만 적용
        // force 렌더(scrollToLine, loadFile 등)는 이론적 값 유지하여 명시적 위치 이동 보존
        // word wrap 시 이론적 계산(scrollTop / lineHeight)은 누적 오차로 부정확해짐
        if (!force && renderedStartLine >= 0 && linesContainer.children.length > 0) {
            const scrollRect = scrollArea.getBoundingClientRect();
            for (let i = 0; i < linesContainer.children.length; i++) {
                const rect = linesContainer.children[i].getBoundingClientRect();
                if (rect.bottom > scrollRect.top) {
                    firstVisible = renderedStartLine + i;
                    break;
                }
            }
        }

        const newCurrentLine = firstVisible + 1;
        if (newCurrentLine !== currentLine) {
            currentLine = newCurrentLine;
            if (onLineChange) onLineChange(currentLine, totalLines);
        }

        // 마진 기반 재렌더: 뷰포트가 렌더 범위 가장자리에 접근할 때만 재렌더
        if (!force && renderedStartLine >= 0) {
            const topMargin = firstVisible - renderedStartLine;
            const bottomMargin = renderedEndLine - (firstVisible + visibleCount);
            if (topMargin >= RERENDER_MARGIN && bottomMargin >= RERENDER_MARGIN) {
                lastScrollTop = scrollTop;
                return;
            }
        }

        // 스크롤 방향 감지하여 해당 방향에 약간 더 많은 버퍼 (급변 방지)
        const scrollingDown = scrollTop >= lastScrollTop;
        lastScrollTop = scrollTop;
        const bufferAbove = scrollingDown ? BUFFER_LINES * 2 / 3 | 0 : BUFFER_LINES;
        const bufferBelow = scrollingDown ? BUFFER_LINES : BUFFER_LINES * 2 / 3 | 0;

        // CHUNK_ALIGN 단위로 정렬하여 캐시 히트율 향상
        const rawStart = Math.max(0, firstVisible - bufferAbove);
        const rawEnd = Math.min(totalLines, firstVisible + visibleCount + bufferBelow);
        const startLine = Math.floor(rawStart / CHUNK_ALIGN) * CHUNK_ALIGN;
        const endLine = Math.min(totalLines, Math.ceil(rawEnd / CHUNK_ALIGN) * CHUNK_ALIGN);

        if (!force && startLine === renderedStartLine && endLine === renderedEndLine) {
            return;
        }

        const chunk = await getChunk(startLine, endLine);
        if (!chunk) return;

        // 비동기 대기 중 새 렌더가 예약되었으면 이 결과를 폐기
        if (thisGeneration !== renderGeneration) return;

        // 앵커 보존: 렌더 전 firstVisible 줄의 화면 위치 기록 (word wrap 점프 방지)
        let anchorScreenY = null;
        if (!force && renderedStartLine >= 0) {
            const anchorIdx = firstVisible - renderedStartLine;
            if (anchorIdx >= 0 && anchorIdx < linesContainer.children.length) {
                anchorScreenY = linesContainer.children[anchorIdx].getBoundingClientRect().top;
            }
        }

        // spacerTop 이론적 계산 + DOM 렌더
        const renderedLines = endLine - startLine;
        const totalVirtualHeight = Math.min(totalLines * lineHeight, MAX_SCROLL_HEIGHT);
        const topHeight = Math.max(0, scrollTop - (firstVisible - startLine) * lineHeight);
        spacerTop.style.height = topHeight + 'px';

        renderLines(chunk.lines, startLine);

        renderedStartLine = startLine;
        renderedEndLine = endLine;

        // 앵커 복원: 렌더 후 같은 줄의 새 위치와 비교하여 spacerTop 보정
        // scrollTop을 건드리지 않으므로 onScroll 미발생, 재렌더 루프 없음
        if (anchorScreenY !== null) {
            const newAnchorIdx = firstVisible - startLine;
            if (newAnchorIdx >= 0 && newAnchorIdx < linesContainer.children.length) {
                const newScreenY = linesContainer.children[newAnchorIdx].getBoundingClientRect().top;
                const drift = newScreenY - anchorScreenY;
                if (Math.abs(drift) > 1) {
                    spacerTop.style.height = Math.max(0, topHeight - drift) + 'px';
                }
            }
        } else {
            // 앵커 없음 (렌더 범위 밖으로 스크롤했거나 force 렌더)
            // DOM 측정으로 firstVisible 줄이 뷰포트 상단에 오도록 spacerTop 보정
            const visibleIdx = firstVisible - startLine;
            if (visibleIdx >= 0 && visibleIdx < linesContainer.children.length) {
                const lineRect = linesContainer.children[visibleIdx].getBoundingClientRect();
                const scrollRect = scrollArea.getBoundingClientRect();
                const drift = lineRect.top - scrollRect.top;
                if (Math.abs(drift) > 1) {
                    spacerTop.style.height = Math.max(0, topHeight - drift) + 'px';
                }
            }
        }

        // spacerBottom: 보정된 spacerTop 기준으로 계산
        const actualRenderedHeight = linesContainer.getBoundingClientRect().height;
        const currentTopHeight = parseFloat(spacerTop.style.height) || 0;
        spacerBottom.style.height = Math.max(0,
            totalVirtualHeight - currentTopHeight - actualRenderedHeight) + 'px';

        // 스크롤 방향으로 다음 청크 프리페치
        const prefetchStart = scrollingDown
            ? endLine
            : Math.max(0, startLine - CHUNK_ALIGN);
        const prefetchEnd = scrollingDown
            ? Math.min(totalLines, endLine + CHUNK_ALIGN)
            : startLine;
        if (prefetchStart < prefetchEnd) {
            getChunk(prefetchStart, prefetchEnd);
        }

        // 검색 결과 스크롤 보정: 렌더링 후 실제 DOM 위치 기반으로 중앙 정렬
        if (pendingScrollToMatch) {
            pendingScrollToMatch = false;
            const activeEl = linesContainer.querySelector('.search-match-active');
            if (activeEl) {
                const elRect = activeEl.getBoundingClientRect();
                const scrollRect = scrollArea.getBoundingClientRect();
                const offset = (elRect.top + elRect.height / 2) - (scrollRect.top + scrollRect.height / 2);
                if (Math.abs(offset) > 2) {
                    scrollArea.scrollTop += offset;
                }
            }
        }
    } catch {
        // 렌더링 실패
    } finally {
        isRendering = false;
        if (pendingRender) {
            pendingRender = false;
            // scheduleRender()는 force=true → 이론적 firstVisible 사용 → word wrap 점프 유발
            // pendingRender는 스크롤 중 동시 렌더 요청이므로 force=false로 DOM 기반 렌더
            if (!renderSuppressed) {
                if (scrollRAF) cancelAnimationFrame(scrollRAF);
                scrollRAF = requestAnimationFrame(async () => {
                    scrollRAF = null;
                    await renderVisibleLines();
                });
            }
        }
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

        if (cachedChunks.size > 30) {
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

export async function setActiveMatch(index) {
    activeMatchIndex = index;
    if (index >= 0 && index < searchMatches.length) {
        const match = searchMatches[index];
        pendingScrollToMatch = true;
        cachedChunks.clear();
        await scrollToLine(match.line + 1);
    } else {
        cachedChunks.clear();
    }
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

export async function scrollToLine(lineNumber) {
    if (lineNumber < 1 || lineNumber > totalLines) return;
    currentLine = lineNumber;
    if (onLineChange) onLineChange(currentLine, totalLines);

    // 1단계: 이론적 위치로 이동하여 대상 줄의 청크 로딩
    const ratio = getScrollRatio();
    const viewportHeight = scrollArea.clientHeight;
    scrollArea.scrollTop = (lineNumber - 1) * lineHeight * ratio - viewportHeight / 2 + lineHeight / 2;
    renderGeneration++;
    await renderVisibleLines(true);

    // 2단계: 모든 pending 렌더 소화 대기 (2프레임)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // 3단계: DOM에서 대상 줄을 찾아 정확히 중앙 배치
    const targetIdx = lineNumber - 1 - renderedStartLine;
    if (targetIdx >= 0 && targetIdx < linesContainer.children.length) {
        const lineEl = linesContainer.children[targetIdx];
        const lineRect = lineEl.getBoundingClientRect();
        const scrollRect = scrollArea.getBoundingClientRect();
        const offset = (lineRect.top + lineRect.height / 2) - (scrollRect.top + scrollRect.height / 2);
        if (Math.abs(offset) > 1) {
            scrollArea.scrollTop += offset;
        }
    }
    lastScrollTop = scrollArea.scrollTop;
    // 후속 자동 렌더 취소 (DOM 보정이 뒤집히는 것 방지)
    if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
    pendingRender = false;
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
