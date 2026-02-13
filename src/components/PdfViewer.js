/**
 * PdfViewer - PDF page-based renderer using pdf.js (Mozilla)
 * Renders PDF pages on Canvas elements.
 * Supports single page and continuous scroll modes.
 */

import { invoke } from '@tauri-apps/api/core';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// State
let currentFileId = null;
let currentFilePath = null;
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let onPageChange = null;

// Zoom state
let zoomLevel = 100;
const ZOOM_MIN = 30;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

// Continuous mode state
let continuousMode = false;
let continuousContainer = null;

// Rendering lock (prevent concurrent renders)
let rendering = false;

// DOM elements
const container = document.getElementById('pdf-viewer-container');
const pageInput = document.getElementById('pdf-page-input');
const pageLabel = document.getElementById('pdf-page-label');
const btnPrev = document.getElementById('pdf-btn-prev');
const btnNext = document.getElementById('pdf-btn-next');
const contentArea = document.getElementById('pdf-content');
const btnZoomIn = document.getElementById('pdf-btn-zoom-in');
const btnZoomOut = document.getElementById('pdf-btn-zoom-out');
const zoomLabel = document.getElementById('pdf-zoom-label');
const btnContinuous = document.getElementById('pdf-btn-continuous');

// Single page canvas
let singleCanvas = null;

function clearChildren(el) {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}

export function init(options = {}) {
    onPageChange = options.onPageChange || null;

    // Create canvas for single page mode
    singleCanvas = document.createElement('canvas');
    singleCanvas.id = 'pdf-canvas';
    singleCanvas.className = 'pdf-canvas';
    contentArea.appendChild(singleCanvas);

    // Create scrollable container for continuous mode
    continuousContainer = document.createElement('div');
    continuousContainer.id = 'pdf-continuous';
    continuousContainer.style.cssText = 'width:100%;height:100%;overflow-y:auto;display:none;position:relative;';
    contentArea.appendChild(continuousContainer);

    btnPrev.addEventListener('click', () => goToPage(currentPage - 1));
    btnNext.addEventListener('click', () => goToPage(currentPage + 1));

    // Page input: Enter to navigate
    pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const num = parseInt(pageInput.value, 10);
            if (!isNaN(num)) {
                if (continuousMode) {
                    scrollToPage(num);
                } else {
                    goToPage(num);
                }
            }
        }
    });

    pageInput.addEventListener('blur', () => {
        pageInput.value = currentPage;
    });

    // Zoom controls
    btnZoomIn.addEventListener('click', () => setZoom(zoomLevel + ZOOM_STEP));
    btnZoomOut.addEventListener('click', () => setZoom(zoomLevel - ZOOM_STEP));
    zoomLabel.addEventListener('dblclick', () => setZoom(100));

    // Continuous mode toggle
    btnContinuous.addEventListener('click', toggleContinuousMode);

    // Keyboard navigation
    contentArea.addEventListener('keydown', handleKeydown);
}

function handleKeydown(e) {
    // Zoom: Ctrl+Plus / Ctrl+Minus / Ctrl+0
    if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            setZoom(zoomLevel + ZOOM_STEP);
            return;
        }
        if (e.key === '-') {
            e.preventDefault();
            setZoom(zoomLevel - ZOOM_STEP);
            return;
        }
        if (e.key === '0') {
            e.preventDefault();
            setZoom(100);
            return;
        }
    }

    // Page navigation (single page mode only)
    if (!continuousMode) {
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            if (currentPage > 1) {
                e.preventDefault();
                goToPage(currentPage - 1);
            }
        }
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
            if (currentPage < totalPages) {
                e.preventDefault();
                goToPage(currentPage + 1);
            }
        }
        if (e.key === 'Home') {
            e.preventDefault();
            goToPage(1);
        }
        if (e.key === 'End') {
            e.preventDefault();
            goToPage(totalPages);
        }
    }
}

function setZoom(level) {
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
    zoomLabel.textContent = zoomLevel + '%';

    if (continuousMode) {
        renderAllPages(currentPage);
    } else {
        renderPage(currentPage);
    }
}

export async function loadFile(fileInfo) {
    currentFileId = fileInfo.id;
    currentFilePath = fileInfo.path;
    currentPage = fileInfo.last_position || 1;
    if (currentPage < 1) currentPage = 1;

    try {
        const bytes = await invoke('read_pdf_bytes', { fileId: currentFileId });
        const data = new Uint8Array(bytes);
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        totalPages = pdfDoc.numPages;
    } catch (e) {
        pdfDoc = null;
        totalPages = 0;
    }

    if (currentPage > totalPages) currentPage = 1;

    show();

    if (continuousMode) {
        await renderAllPages();
    } else {
        await goToPage(currentPage);
    }
}

async function goToPage(num) {
    if (!pdfDoc || num < 1 || num > totalPages) return;

    currentPage = num;
    pageInput.value = num;
    pageLabel.textContent = '/ ' + totalPages;

    btnPrev.disabled = num === 1;
    btnNext.disabled = num >= totalPages;

    await renderPage(num);

    if (onPageChange) {
        onPageChange(currentPage, totalPages);
    }
}

async function renderPage(num) {
    if (!pdfDoc || rendering) return;
    rendering = true;

    try {
        const page = await pdfDoc.getPage(num);
        const scale = zoomLevel / 100;
        const viewport = page.getViewport({ scale: scale * window.devicePixelRatio });

        singleCanvas.width = viewport.width;
        singleCanvas.height = viewport.height;
        singleCanvas.style.width = (viewport.width / window.devicePixelRatio) + 'px';
        singleCanvas.style.height = (viewport.height / window.devicePixelRatio) + 'px';

        const ctx = singleCanvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {
        // 페이지 렌더링 실패
    }

    rendering = false;
}

// --- Continuous mode ---

async function toggleContinuousMode() {
    const savedPage = currentPage; // 모드 전환 전 페이지 보존
    continuousMode = !continuousMode;
    btnContinuous.classList.toggle('active', continuousMode);

    btnPrev.style.display = continuousMode ? 'none' : '';
    btnNext.style.display = continuousMode ? 'none' : '';

    singleCanvas.style.display = continuousMode ? 'none' : 'block';
    continuousContainer.style.display = continuousMode ? 'block' : 'none';

    if (!pdfDoc) return;

    if (continuousMode) {
        await renderAllPages(savedPage);
    } else {
        await goToPage(savedPage);
    }
}

async function renderAllPages(targetPage) {
    if (!pdfDoc) return;

    const scrollTarget = targetPage || currentPage;

    pageLabel.textContent = '/ ' + totalPages;

    // scroll 리스너 제거 후 컨텐츠 초기화 (currentPage 오염 방지)
    continuousContainer.removeEventListener('scroll', trackPageOnScroll);
    clearChildren(continuousContainer);

    const scale = zoomLevel / 100;

    // 1단계: 모든 페이지 메타데이터를 병렬로 가져옴 (빠름)
    const pages = await Promise.all(
        Array.from({ length: totalPages }, (_, i) =>
            pdfDoc.getPage(i + 1).catch(() => null)
        )
    );

    // 2단계: wrapper + canvas 크기만 설정 (렌더링 없이 레이아웃 확보)
    const renderQueue = [];
    for (let i = 0; i < totalPages; i++) {
        const page = pages[i];
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.page = i + 1;

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        wrapper.appendChild(canvas);
        continuousContainer.appendChild(wrapper);

        if (page) {
            const viewport = page.getViewport({ scale: scale * window.devicePixelRatio });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = (viewport.width / window.devicePixelRatio) + 'px';
            canvas.style.height = (viewport.height / window.devicePixelRatio) + 'px';
            renderQueue.push({ canvas, page, viewport });
        }
    }

    // 3단계: 레이아웃 완료 → 대상 페이지로 즉시 스크롤
    if (scrollTarget > 1) {
        const wrapper = continuousContainer.querySelector('[data-page="' + scrollTarget + '"]');
        if (wrapper) {
            continuousContainer.scrollTop = wrapper.offsetTop;
        }
    }
    currentPage = scrollTarget;
    pageInput.value = scrollTarget;

    if (onPageChange) {
        onPageChange(currentPage, totalPages);
    }

    // 4단계: 스크롤 리스너 등록 (위치 설정 완료 후)
    continuousContainer.addEventListener('scroll', trackPageOnScroll);

    // 5단계: 캔버스 실제 렌더링 (느림 - 빈 캔버스가 점진적으로 채워짐)
    for (const entry of renderQueue) {
        try {
            const ctx = entry.canvas.getContext('2d');
            await entry.page.render({ canvasContext: ctx, viewport: entry.viewport }).promise;
        } catch {
            // skip failed pages
        }
    }
}

function scrollToPage(num) {
    if (!continuousContainer || num < 1 || num > totalPages) return;
    const wrapper = continuousContainer.querySelector('[data-page="' + num + '"]');
    if (wrapper) {
        wrapper.scrollIntoView({ behavior: 'smooth' });
        currentPage = num;
        pageInput.value = num;
    }
}

function trackPageOnScroll() {
    if (!continuousMode || !continuousContainer) return;

    const wrappers = continuousContainer.querySelectorAll('[data-page]');
    const threshold = continuousContainer.clientHeight * 0.3;
    const containerTop = continuousContainer.getBoundingClientRect().top;

    let visiblePage = 1;
    for (const w of wrappers) {
        const rect = w.getBoundingClientRect();
        if (rect.top - containerTop <= threshold) {
            visiblePage = parseInt(w.dataset.page, 10);
        } else {
            break;
        }
    }

    if (visiblePage !== currentPage) {
        currentPage = visiblePage;
        pageInput.value = visiblePage;

        if (onPageChange) {
            onPageChange(currentPage, totalPages);
        }
    }
}

// --- Public API ---

export function show() {
    container.classList.remove('hidden');
}

export function hide() {
    container.classList.add('hidden');
}

export function clear() {
    currentFileId = null;
    currentFilePath = null;
    pdfDoc = null;
    currentPage = 1;
    totalPages = 0;
    if (singleCanvas) {
        const ctx = singleCanvas.getContext('2d');
        ctx.clearRect(0, 0, singleCanvas.width, singleCanvas.height);
    }
    if (continuousContainer) clearChildren(continuousContainer);
    hide();
}

export function navigateToPage(num) {
    if (continuousMode) {
        scrollToPage(num);
    } else {
        goToPage(num);
    }
}

export function getCurrentFileId() {
    return currentFileId;
}

export function getCurrentFilePath() {
    return currentFilePath;
}

export function getCurrentPage() {
    return currentPage;
}

export function getTotalPages() {
    return totalPages;
}

export function isVisible() {
    return !container.classList.contains('hidden');
}
