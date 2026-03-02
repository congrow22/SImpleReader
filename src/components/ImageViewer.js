/**
 * ImageViewer - Single image viewer with prev/next navigation
 * Supports folder images and ZIP archive images.
 */

import { invoke } from '@tauri-apps/api/core';

// State
let currentFileId = null;
let currentFilePath = null;
let imageNames = [];
let currentIndex = 0;
let totalImages = 0;
let onImageChange = null;
let onOpenFile = null;

// ZIP 시리즈 탐색 상태
let isZipFile = false;
let prevZipPath = null;
let nextZipPath = null;

// Zoom state
let zoomLevel = 100;
let fitToPage = true;
const ZOOM_MIN = 10;
const ZOOM_MAX = 500;
const ZOOM_STEP = 10;

// Current blob URL (must be revoked when switching images)
let currentBlobUrl = null;

// DOM elements
const container = document.getElementById('image-viewer-container');
const pageInput = document.getElementById('image-page-input');
const pageLabel = document.getElementById('image-page-label');
const btnPrev = document.getElementById('image-btn-prev');
const btnNext = document.getElementById('image-btn-next');
const contentArea = document.getElementById('image-content');
const btnZoomIn = document.getElementById('image-btn-zoom-in');
const btnZoomOut = document.getElementById('image-btn-zoom-out');
const zoomLabel = document.getElementById('image-zoom-label');
const btnFitToPage = document.getElementById('image-btn-fit');
const loadingOverlay = document.getElementById('image-loading-overlay');
const imageNameLabel = document.getElementById('image-name-label');

let imgElement = null;

export function init(options = {}) {
    onImageChange = options.onImageChange || null;
    onOpenFile = options.onOpenFile || null;

    // Create img element
    imgElement = document.createElement('img');
    imgElement.className = 'image-display';
    imgElement.draggable = false;
    contentArea.appendChild(imgElement);

    // Side navigation arrows
    const arrowPrev = document.createElement('button');
    arrowPrev.className = 'image-side-arrow image-side-arrow-left';
    arrowPrev.innerHTML = '<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor"><path d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/></svg>';
    arrowPrev.addEventListener('click', () => goToImage(currentIndex - 1));
    contentArea.appendChild(arrowPrev);

    const arrowNext = document.createElement('button');
    arrowNext.className = 'image-side-arrow image-side-arrow-right';
    arrowNext.innerHTML = '<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>';
    arrowNext.addEventListener('click', () => goToImage(currentIndex + 1));
    contentArea.appendChild(arrowNext);

    // Navigation (top bar buttons)
    btnPrev.addEventListener('click', () => goToImage(currentIndex - 1));
    btnNext.addEventListener('click', () => goToImage(currentIndex + 1));

    // Page input
    pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const num = parseInt(pageInput.value, 10);
            if (!isNaN(num) && num >= 1 && num <= totalImages) {
                goToImage(num - 1);
            }
        }
    });
    pageInput.addEventListener('blur', () => {
        pageInput.value = currentIndex + 1;
    });

    // Zoom controls
    btnZoomIn.addEventListener('click', () => setZoom(zoomLevel + ZOOM_STEP));
    btnZoomOut.addEventListener('click', () => setZoom(zoomLevel - ZOOM_STEP));
    zoomLabel.addEventListener('dblclick', () => toggleFitToPage());
    btnFitToPage.addEventListener('click', () => toggleFitToPage());

    // Keyboard navigation
    contentArea.addEventListener('keydown', handleKeydown);
}

function handleKeydown(e) {
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
            toggleFitToPage();
            return;
        }
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToImage(currentIndex - 1);
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToImage(currentIndex + 1);
    }
    if (e.key === 'Home') {
        e.preventDefault();
        goToImage(0);
    }
    if (e.key === 'End') {
        e.preventDefault();
        goToImage(totalImages - 1);
    }
}

function setZoom(level) {
    fitToPage = false;
    btnFitToPage.classList.remove('active');
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
    zoomLabel.textContent = zoomLevel + '%';
    applyZoom();
}

function toggleFitToPage() {
    fitToPage = !fitToPage;
    btnFitToPage.classList.toggle('active', fitToPage);
    if (fitToPage) {
        zoomLevel = 100;
        zoomLabel.textContent = '맞춤';
    } else {
        zoomLabel.textContent = zoomLevel + '%';
    }
    applyZoom();
}

function applyZoom() {
    if (!imgElement) return;
    if (fitToPage) {
        // 페이지 맞춤: 작은 이미지도 컨테이너에 맞게 확대
        imgElement.style.maxWidth = '100%';
        imgElement.style.maxHeight = '100%';
        imgElement.style.width = '100%';
        imgElement.style.height = '100%';
        imgElement.style.objectFit = 'contain';
    } else if (zoomLevel === 100) {
        // 원본 크기
        imgElement.style.maxWidth = '100%';
        imgElement.style.maxHeight = '100%';
        imgElement.style.width = '';
        imgElement.style.height = '';
        imgElement.style.objectFit = '';
    } else {
        // 수동 줌
        imgElement.style.maxWidth = 'none';
        imgElement.style.maxHeight = 'none';
        imgElement.style.width = (zoomLevel) + '%';
        imgElement.style.height = 'auto';
        imgElement.style.objectFit = '';
    }
}

export async function loadFile(fileInfo) {
    currentFileId = fileInfo.id;
    currentFilePath = fileInfo.path;
    totalImages = fileInfo.total_images || 0;
    currentIndex = fileInfo.last_position || 0;
    zoomLevel = 100;
    fitToPage = true;
    btnFitToPage.classList.add('active');
    zoomLabel.textContent = '맞춤';

    // Load image list from backend
    try {
        imageNames = await invoke('get_image_list', { fileId: currentFileId });
        totalImages = imageNames.length;
    } catch {
        imageNames = [];
        totalImages = 0;
    }

    // If an initial image name is provided, find its index in the list
    let nameIdx = -1;
    if (fileInfo.initial_image_name && imageNames.length > 0) {
        const targetName = fileInfo.initial_image_name.toLowerCase();
        nameIdx = imageNames.findIndex(n => {
            const shortName = (n.split('/').pop() || n).toLowerCase();
            return shortName === targetName;
        });
        if (nameIdx >= 0) {
            currentIndex = nameIdx;
        }
    }

    if (currentIndex >= totalImages) currentIndex = 0;

    // ZIP 파일이면 시리즈 정보 로드
    isZipFile = (currentFilePath || '').toLowerCase().endsWith('.zip');
    prevZipPath = null;
    nextZipPath = null;
    if (isZipFile) {
        try {
            const info = await invoke('get_adjacent_zips', { fileId: currentFileId });
            prevZipPath = info.prev_path || null;
            nextZipPath = info.next_path || null;
        } catch {
            // 시리즈 정보 없음
        }
    }

    show();
    contentArea.focus();
    await goToImage(currentIndex);
}

async function goToImage(index) {
    // 범위 초과 시 인접 ZIP으로 전환
    if (index >= totalImages && isZipFile && nextZipPath && onOpenFile) {
        onOpenFile(nextZipPath);
        return;
    }
    if (index < 0 && isZipFile && prevZipPath && onOpenFile) {
        onOpenFile(prevZipPath, { startFromEnd: true });
        return;
    }
    if (index < 0 || index >= totalImages || !currentFileId) return;

    showLoading();
    currentIndex = index;
    pageInput.value = index + 1;
    pageLabel.textContent = '/ ' + totalImages;

    btnPrev.disabled = index === 0;
    btnNext.disabled = index >= totalImages - 1;

    // Show filename
    if (imageNameLabel && imageNames[index]) {
        const name = imageNames[index].split('/').pop() || imageNames[index];
        imageNameLabel.textContent = name;
        imageNameLabel.title = imageNames[index];
    }

    // Revoke previous blob URL
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }

    try {
        const data = await invoke('get_image_bytes', {
            fileId: currentFileId,
            index: index,
        });

        const fileName = imageNames[index] || '';
        const mime = getMimeType(fileName);

        const blob = new Blob([data], { type: mime });
        currentBlobUrl = URL.createObjectURL(blob);
        imgElement.src = currentBlobUrl;
    } catch {
        imgElement.src = '';
    }

    applyZoom();
    hideLoading();

    if (onImageChange) {
        onImageChange(currentIndex, totalImages);
    }
}

function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeMap = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    };
    return mimeMap[ext] || 'image/png';
}

let loadingTimer = null;
function showLoading() {
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => {
        loadingOverlay.classList.remove('hidden');
    }, 1000);
}
function hideLoading() {
    clearTimeout(loadingTimer);
    loadingOverlay.classList.add('hidden');
}

export function show() { container.classList.remove('hidden'); }
export function hide() { container.classList.add('hidden'); }

export function clear() {
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }
    currentFileId = null;
    currentFilePath = null;
    imageNames = [];
    currentIndex = 0;
    totalImages = 0;
    if (imgElement) imgElement.src = '';
    hide();
}

export function getCurrentFileId() { return currentFileId; }
export function getCurrentFilePath() { return currentFilePath; }
export function getCurrentIndex() { return currentIndex; }
export function getTotalImages() { return totalImages; }
export function isVisible() { return !container.classList.contains('hidden'); }

export function navigateToImage(index) {
    goToImage(index);
}
