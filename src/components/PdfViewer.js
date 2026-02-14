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

// Lazy rendering state
let pageObserver = null;
let renderedPages = new Set();

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
const loadingOverlay = document.getElementById('pdf-loading-overlay');

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
        // ipc::Response로 바이너리 직접 전송 (JSON 직렬화 없이 ArrayBuffer로 수신)
        const data = await invoke('read_pdf_bytes', { fileId: currentFileId });
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        totalPages = pdfDoc.numPages;
    } catch {
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

    // 로딩 오버레이 표시
    showLoading();

    pageLabel.textContent = '/ ' + totalPages;

    // Observer 정리
    if (pageObserver) pageObserver.disconnect();
    renderedPages.clear();

    // scroll 리스너 제거 후 컨텐츠 초기화 (currentPage 오염 방지)
    continuousContainer.removeEventListener('scroll', trackPageOnScroll);
    clearChildren(continuousContainer);

    const scale = zoomLevel / 100;

    // 1단계: 첫 페이지에서 기준 크기 확보 (1회만)
    const firstPage = await pdfDoc.getPage(1);
    const refViewport = firstPage.getViewport({ scale: scale * window.devicePixelRatio });

    // 2단계: 모든 wrapper+canvas를 기준 크기로 즉시 생성 (async 불필요)
    for (let i = 0; i < totalPages; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.page = i + 1;

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        canvas.width = refViewport.width;
        canvas.height = refViewport.height;
        canvas.style.width = (refViewport.width / window.devicePixelRatio) + 'px';
        canvas.style.height = (refViewport.height / window.devicePixelRatio) + 'px';

        wrapper.appendChild(canvas);
        continuousContainer.appendChild(wrapper);
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

    // 4단계: 로딩 숨기고 스크롤 리스너 등록
    hideLoading();
    continuousContainer.addEventListener('scroll', trackPageOnScroll);

    // 5단계: IntersectionObserver로 보이는 페이지만 렌더링
    pageObserver = new IntersectionObserver(handlePageIntersect, {
        root: continuousContainer,
        rootMargin: '200px 0px',
    });
    const wrappers = continuousContainer.querySelectorAll('[data-page]');
    wrappers.forEach(w => pageObserver.observe(w));
}

function handlePageIntersect(entries) {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const pageNum = parseInt(entry.target.dataset.page, 10);
        if (renderedPages.has(pageNum)) continue;
        renderedPages.add(pageNum);
        renderLazyPage(entry.target, pageNum);
    }
}

async function renderLazyPage(wrapper, pageNum) {
    try {
        const page = await pdfDoc.getPage(pageNum);
        const scale = zoomLevel / 100;
        const viewport = page.getViewport({ scale: scale * window.devicePixelRatio });
        const canvas = wrapper.querySelector('canvas');

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = (viewport.width / window.devicePixelRatio) + 'px';
        canvas.style.height = (viewport.height / window.devicePixelRatio) + 'px';

        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {
        // skip failed pages
    }
}

function showLoading() { loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }

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
    if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
    renderedPages.clear();
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
