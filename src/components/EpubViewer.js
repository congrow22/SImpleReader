/**
 * EpubViewer - EPUB chapter-based HTML renderer (iframe approach)
 * Uses iframe srcdoc for complete document isolation, like Calibre.
 * This ensures body{} CSS selectors and @font-face work naturally.
 *
 * Continuous mode uses per-chapter iframes (not one combined document)
 * to preserve CSS isolation and avoid DRM decoy element conflicts.
 */

import { invoke } from '@tauri-apps/api/core';

// State
let currentFileId = null;
let currentFilePath = null;
let chapters = [];
let currentChapterIndex = 0;
let totalChapters = 0;
let onChapterChange = null;

// Font styles (@font-face CSS with base64 data URIs) - loaded once per file
let fontStylesCss = '';

// Zoom state
let zoomLevel = 100;
const ZOOM_MIN = 30;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

// Continuous mode state
let continuousMode = false;
let continuousContainer = null;

// DOM elements
const container = document.getElementById('epub-viewer-container');
const chapterSelect = document.getElementById('epub-chapter-select');
const chapterLabel = document.getElementById('epub-chapter-label');
const btnPrev = document.getElementById('epub-btn-prev');
const btnNext = document.getElementById('epub-btn-next');
const contentArea = document.getElementById('epub-content');
const btnZoomIn = document.getElementById('epub-btn-zoom-in');
const btnZoomOut = document.getElementById('epub-btn-zoom-out');
const zoomLabel = document.getElementById('epub-zoom-label');
const btnContinuous = document.getElementById('epub-btn-continuous');

// iframe for rendering EPUB chapters (single chapter mode)
let iframe = null;

export function init(options = {}) {
    onChapterChange = options.onChapterChange || null;

    // Create iframe for single chapter mode
    iframe = document.createElement('iframe');
    iframe.id = 'epub-iframe';
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    contentArea.appendChild(iframe);

    // Create scrollable container for continuous mode (per-chapter iframes)
    continuousContainer = document.createElement('div');
    continuousContainer.id = 'epub-continuous';
    continuousContainer.style.cssText = 'width:100%;height:100%;overflow-y:auto;display:none;';
    contentArea.appendChild(continuousContainer);

    btnPrev.addEventListener('click', () => goToChapter(currentChapterIndex - 1));
    btnNext.addEventListener('click', () => goToChapter(currentChapterIndex + 1));

    chapterSelect.addEventListener('change', () => {
        const idx = parseInt(chapterSelect.value, 10);
        if (!isNaN(idx)) {
            if (continuousMode) {
                scrollToChapter(idx);
            } else {
                goToChapter(idx);
            }
        }
    });

    // Zoom controls
    btnZoomIn.addEventListener('click', () => setZoom(zoomLevel + ZOOM_STEP));
    btnZoomOut.addEventListener('click', () => setZoom(zoomLevel - ZOOM_STEP));
    zoomLabel.addEventListener('dblclick', () => setZoom(100));

    // Continuous mode toggle
    btnContinuous.addEventListener('click', toggleContinuousMode);

    // Keyboard navigation on container (when iframe doesn't have focus)
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

    // Chapter navigation (only in single chapter mode)
    if (!continuousMode) {
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            if (currentChapterIndex > 0) {
                e.preventDefault();
                goToChapter(currentChapterIndex - 1);
            }
        }
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
            if (currentChapterIndex < totalChapters - 1) {
                e.preventDefault();
                goToChapter(currentChapterIndex + 1);
            }
        }
    }
}

function setZoom(level) {
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
    zoomLabel.textContent = zoomLevel + '%';
    applyZoom();
}

function applyZoom() {
    if (continuousMode) {
        // Apply zoom to all chapter iframes
        const iframes = continuousContainer.querySelectorAll('iframe');
        iframes.forEach(f => {
            if (f.contentDocument && f.contentDocument.body) {
                f.contentDocument.body.style.zoom = (zoomLevel / 100).toString();
                resizeIframeToContent(f);
            }
        });
    } else {
        if (!iframe || !iframe.contentDocument) return;
        const body = iframe.contentDocument.body;
        if (body) {
            body.style.zoom = (zoomLevel / 100).toString();
        }
    }
}

export async function loadFile(fileInfo) {
    currentFileId = fileInfo.id;
    currentFilePath = fileInfo.path;
    totalChapters = fileInfo.total_chapters || 0;
    currentChapterIndex = fileInfo.last_position || 0;

    // Load chapter list
    try {
        chapters = await invoke('get_epub_chapters', { fileId: currentFileId });
    } catch {
        chapters = [];
    }

    // Populate chapter select dropdown
    while (chapterSelect.firstChild) {
        chapterSelect.removeChild(chapterSelect.firstChild);
    }
    chapters.forEach((ch, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = ch.title || ('Chapter ' + (i + 1));
        chapterSelect.appendChild(opt);
    });

    // Load font styles (@font-face with data URIs) once per file.
    try {
        fontStylesCss = await invoke('get_epub_font_styles', { fileId: currentFileId });
    } catch {
        fontStylesCss = '';
    }

    show();

    if (continuousMode) {
        await loadAllChapters();
    } else {
        await goToChapter(currentChapterIndex);
    }
}

async function goToChapter(index) {
    if (index < 0 || index >= totalChapters || !currentFileId) return;

    currentChapterIndex = index;
    chapterSelect.value = index;

    // Update navigation state
    btnPrev.disabled = index === 0;
    btnNext.disabled = index >= totalChapters - 1;

    // Update label
    const chTitle = chapters[index] ? chapters[index].title : ('Chapter ' + (index + 1));
    chapterLabel.textContent = (index + 1) + ' / ' + totalChapters;

    try {
        const html = await invoke('get_epub_chapter', {
            fileId: currentFileId,
            chapterIndex: index
        });
        renderSingleChapter(html);
    } catch {
        renderSingleChapter('<p style="color:red;padding:16px;">챕터를 불러올 수 없습니다.</p>');
    }

    if (onChapterChange) {
        onChapterChange(currentChapterIndex, totalChapters, chTitle);
    }
}

// --- Continuous mode ---

async function toggleContinuousMode() {
    // 전환 전 현재 스크롤 위치 캡처
    const savedScrollPos = getScrollPosition();

    continuousMode = !continuousMode;
    btnContinuous.classList.toggle('active', continuousMode);

    // Hide/show chapter prev/next in continuous mode
    btnPrev.style.display = continuousMode ? 'none' : '';
    btnNext.style.display = continuousMode ? 'none' : '';

    // Switch display between single iframe and continuous container
    iframe.style.display = continuousMode ? 'none' : 'block';
    continuousContainer.style.display = continuousMode ? 'block' : 'none';

    if (!currentFileId) return;

    if (continuousMode) {
        await loadAllChapters(savedScrollPos);
    } else {
        await goToChapter(currentChapterIndex);
        // 단일 모드: iframe 로드 후 스크롤 복원
        if (savedScrollPos > 0) {
            iframe.onload = () => {
                setupIframeContent(iframe);
                if (iframe.contentWindow) {
                    iframe.contentWindow.scrollTo(0, savedScrollPos);
                }
            };
        }
    }
}

async function loadAllChapters(scrollOffset) {
    if (!currentFileId) return;

    const scrollTarget = currentChapterIndex;
    const extraOffset = scrollOffset || 0;
    chapterLabel.textContent = '전체';

    // Clear previous content
    continuousContainer.innerHTML = '';

    const baseStyles = getBaseStyles();
    let loadedCount = 0;
    let scrollRestored = false;

    function tryRestoreScroll() {
        if (scrollRestored) return;
        // 챕터 0이더라도 스크롤 오프셋이 있으면 복원
        if (scrollTarget <= 0 && extraOffset <= 0) return;
        const marker = continuousContainer.querySelector('#epub-ch-' + scrollTarget);
        if (marker) {
            continuousContainer.scrollTop = marker.offsetTop + extraOffset;
            scrollRestored = true;
        }
    }

    for (let i = 0; i < totalChapters; i++) {
        try {
            const html = await invoke('get_epub_chapter', {
                fileId: currentFileId,
                chapterIndex: i
            });
            const title = chapters[i] ? chapters[i].title : ('Chapter ' + (i + 1));

            // Chapter divider (outside iframe, in the scroll container)
            const divider = document.createElement('div');
            divider.id = 'epub-ch-' + i;
            divider.dataset.chapter = i;
            if (i > 0) {
                divider.className = 'epub-chapter-divider';
                divider.innerHTML = '<span>' + escapeHtml(title) + '</span>';
            }
            continuousContainer.appendChild(divider);

            // Per-chapter iframe (identical to single chapter rendering)
            const chIframe = document.createElement('iframe');
            chIframe.className = 'epub-chapter-frame';
            chIframe.style.cssText = 'width:100%;border:none;display:block;overflow:hidden;';
            continuousContainer.appendChild(chIframe);

            const srcdoc = buildSrcdoc(baseStyles, sanitizeHtml(html));
            chIframe.srcdoc = srcdoc;

            chIframe.onload = () => {
                setupIframeContent(chIframe);
                resizeIframeToContent(chIframe);
                loadedCount++;
                // 대상 챕터까지 로드 완료되면 스크롤 복원
                if (loadedCount > scrollTarget) {
                    tryRestoreScroll();
                }
            };
        } catch {
            // skip failed chapters
        }
    }

    // Track which chapter is visible while scrolling
    continuousContainer.addEventListener('scroll', trackChapterOnScroll);

    // 폴백: 300ms 후에도 스크롤 안 됐으면 재시도
    if (scrollTarget > 0) {
        setTimeout(tryRestoreScroll, 300);
        setTimeout(tryRestoreScroll, 600);
    }
}

function scrollToChapter(index) {
    if (!continuousContainer) return;
    const marker = continuousContainer.querySelector('#epub-ch-' + index);
    if (marker) {
        marker.scrollIntoView({ behavior: 'smooth' });
        currentChapterIndex = index;
        chapterSelect.value = index;
    }
}

function trackChapterOnScroll() {
    if (!continuousMode || !continuousContainer) return;

    const dividers = continuousContainer.querySelectorAll('[data-chapter]');
    const threshold = continuousContainer.clientHeight * 0.3;
    const containerTop = continuousContainer.getBoundingClientRect().top;

    let visibleChapter = 0;
    for (const div of dividers) {
        const rect = div.getBoundingClientRect();
        if (rect.top - containerTop <= threshold) {
            visibleChapter = parseInt(div.dataset.chapter, 10);
        } else {
            break;
        }
    }

    if (visibleChapter !== currentChapterIndex) {
        currentChapterIndex = visibleChapter;
        chapterSelect.value = visibleChapter;
        const chTitle = chapters[visibleChapter] ? chapters[visibleChapter].title : ('Chapter ' + (visibleChapter + 1));
        chapterLabel.textContent = (visibleChapter + 1) + ' / ' + totalChapters;

        // Save position
        invoke('get_epub_chapter', {
            fileId: currentFileId,
            chapterIndex: visibleChapter
        }).catch(() => {});

        if (onChapterChange) {
            onChapterChange(currentChapterIndex, totalChapters, chTitle);
        }
    }
}

// --- Rendering ---

function getBaseStyles() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => cs.getPropertyValue(name).trim();

    const bgColor = v('--bg-primary') || '#1e1e1e';
    const textColor = v('--text-primary') || '#d4d4d4';
    const textHighlight = v('--text-highlight') || '#ffffff';
    const textAccent = v('--text-accent') || '#569cd6';
    const textSecondary = v('--text-secondary') || '#808080';
    const borderColor = v('--border') || '#333';
    const accentColor = v('--accent') || '#569cd6';
    const bgSecondary = v('--bg-secondary') || '#252526';
    const fontFamily = v('--font-mono') || 'monospace';
    const fontSize = v('--font-size-editor') || '16px';
    const fontWeight = v('--font-weight-editor') || 'normal';

    return 'html, body { margin: 0; padding: 24px 32px;' +
        ' background: ' + bgColor + ';' +
        ' color: ' + textColor + ';' +
        ' font-family: ' + fontFamily + ';' +
        ' font-size: ' + fontSize + ';' +
        ' font-weight: ' + fontWeight + ';' +
        ' line-height: 1.7;' +
        ' word-wrap: break-word;' +
        ' overflow-wrap: break-word; }\n' +
        'img { max-width: 100%; height: auto; }\n' +
        'div > img:only-child, .ibc img { display: block; margin: 12px auto; }\n' +
        'h1,h2,h3,h4,h5,h6 { color: ' + textHighlight + '; margin: 1em 0 0.5em; line-height: 1.3; }\n' +
        'p { margin: 0.5em 0; }\n' +
        'a { color: ' + textAccent + '; text-decoration: none; }\n' +
        'a:hover { text-decoration: underline; }\n' +
        'blockquote { border-left: 3px solid ' + accentColor + '; padding-left: 16px; margin: 1em 0; color: ' + textSecondary + '; }\n' +
        'table { border-collapse: collapse; margin: 1em 0; width: 100%; }\n' +
        'th, td { border: 1px solid ' + borderColor + '; padding: 6px 10px; text-align: left; }\n' +
        'th { background: ' + bgSecondary + '; }\n' +
        'hr { border: none; border-top: 1px solid ' + borderColor + '; margin: 1.5em 0; }\n';
}

function buildSrcdoc(baseStyles, contentHtml) {
    return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n' +
        '<style>\n' + fontStylesCss + '\n</style>\n' +
        '<style>\n' + baseStyles + '</style>\n' +
        '</head>\n<body>\n' + contentHtml + '\n</body>\n</html>';
}

/**
 * Set up common iframe behaviors: disable links, forward keys, apply zoom.
 */
function setupIframeContent(f) {
    const doc = f.contentDocument;
    if (!doc) return;

    // Disable external links
    doc.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('#')) {
            link.addEventListener('click', (e) => e.preventDefault());
        }
    });

    // Forward keyboard events
    doc.addEventListener('keydown', handleKeydown);

    // Apply zoom
    if (doc.body) {
        doc.body.style.zoom = (zoomLevel / 100).toString();
    }
}

/**
 * Resize an iframe to fit its content (for continuous mode stacking).
 */
function resizeIframeToContent(f) {
    if (!f.contentDocument) return;
    const height = f.contentDocument.documentElement.scrollHeight;
    f.style.height = height + 'px';
}

/**
 * Render a single chapter in the main iframe.
 */
function renderSingleChapter(contentHtml) {
    const sanitized = sanitizeHtml(contentHtml);
    const baseStyles = getBaseStyles();
    iframe.srcdoc = buildSrcdoc(baseStyles, sanitized);

    iframe.onload = () => {
        setupIframeContent(iframe);
        // Scroll to top of new chapter
        if (iframe.contentDocument) {
            iframe.contentDocument.documentElement.scrollTop = 0;
        }
    };
}

/**
 * Sanitize EPUB HTML content before rendering.
 * Removes script tags and inline event handlers for safety.
 */
function sanitizeHtml(html) {
    let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return sanitized;
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function show() {
    container.classList.remove('hidden');
}

export function hide() {
    container.classList.add('hidden');
}

export function clear() {
    currentFileId = null;
    currentFilePath = null;
    chapters = [];
    currentChapterIndex = 0;
    totalChapters = 0;
    fontStylesCss = '';
    if (iframe) iframe.srcdoc = '';
    if (continuousContainer) continuousContainer.innerHTML = '';
    while (chapterSelect.firstChild) {
        chapterSelect.removeChild(chapterSelect.firstChild);
    }
    hide();
}

export function getCurrentFileId() {
    return currentFileId;
}

export function getCurrentFilePath() {
    return currentFilePath;
}

export function getCurrentChapter() {
    return currentChapterIndex;
}

export function getTotalChapters() {
    return totalChapters;
}

export function navigateToChapter(index, scrollPosition) {
    if (continuousMode) {
        // 연속 모드: 챕터 마커 위치 + 저장된 스크롤 오프셋으로 직접 이동
        const marker = continuousContainer.querySelector('#epub-ch-' + index);
        if (marker) {
            continuousContainer.scrollTop = marker.offsetTop + (scrollPosition || 0);
            currentChapterIndex = index;
            chapterSelect.value = index;
        }
    } else {
        goToChapter(index).then(() => {
            if (scrollPosition > 0 && iframe) {
                // goToChapter의 onload가 scrollTop=0으로 초기화하므로
                // onload를 교체하여 저장된 위치로 스크롤 복원
                iframe.onload = () => {
                    setupIframeContent(iframe);
                    if (iframe.contentWindow) {
                        iframe.contentWindow.scrollTo(0, scrollPosition);
                    }
                };
            }
        });
    }
}

export function getScrollPosition() {
    if (continuousMode && continuousContainer) {
        // 현재 챕터 시작 기준 상대 스크롤 위치 저장
        const marker = continuousContainer.querySelector('#epub-ch-' + currentChapterIndex);
        if (marker) {
            return Math.max(0, Math.floor(continuousContainer.scrollTop - marker.offsetTop));
        }
        return 0;
    }
    if (iframe && iframe.contentWindow) {
        return Math.floor(iframe.contentWindow.scrollY || 0);
    }
    return 0;
}

export function isVisible() {
    return !container.classList.contains('hidden');
}
