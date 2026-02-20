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
let chapterObserver = null;
let renderedChapters = new Set();
let pendingScrollRestore = null; // { chapter, offset } - 대상 챕터 로드 후 정확한 스크롤 복원용
const CHAPTER_ESTIMATED_HEIGHT = 800;

// 챕터 로딩 큐 (동시 로딩 수 제한으로 전환 속도 개선)
let chapterLoadQueue = [];
let activeChapterLoads = 0;
const MAX_CONCURRENT_CHAPTER_LOADS = 2;

// 딜레이 로딩 인디케이터 (500ms 이상 걸릴 때만 표시)
let loadingTimer = null;
const loadingEl = document.getElementById('epub-loading-overlay');

function showLoadingDelayed(delay = 500) {
    if (loadingTimer) clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => {
        if (loadingEl) loadingEl.classList.remove('hidden');
        loadingTimer = null;
    }, delay);
}

function hideLoading() {
    clearTimeout(loadingTimer);
    loadingTimer = null;
    if (loadingEl) loadingEl.classList.add('hidden');
}

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

    // wheel 이벤트 직접 처리: iframe 포커스 소실 시 스크롤 멈춤 방지
    // (커서가 iframe 밖 영역에 있을 때의 fallback)
    contentArea.addEventListener('wheel', (e) => {
        if (continuousMode) {
            continuousContainer.scrollTop += e.deltaY;
            e.preventDefault();
        } else if (iframe && iframe.contentWindow) {
            iframe.contentWindow.scrollBy(0, e.deltaY);
            e.preventDefault();
        }
    }, { passive: false });
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
    showLoadingDelayed();
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

    const savedScrollOffset = fileInfo.last_scroll_offset || 0;

    if (continuousMode) {
        await loadAllChapters(savedScrollOffset);
    } else {
        if (savedScrollOffset > 0) {
            // 챕터 로딩 후 스크롤 오프셋 복원 (책갈피와 동일한 방식)
            navigateToChapter(currentChapterIndex, savedScrollOffset);
        } else {
            await goToChapter(currentChapterIndex);
        }
    }
}

async function goToChapter(index) {
    if (index < 0 || index >= totalChapters || !currentFileId) return;
    showLoadingDelayed();

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

    // 전환 대상을 미리 숨김 (레이아웃은 유지, 깜빡임 방지)
    if (continuousMode) {
        continuousContainer.style.visibility = 'hidden';
    } else {
        iframe.style.visibility = 'hidden';
    }

    // Switch display between single iframe and continuous container
    iframe.style.display = continuousMode ? 'none' : 'block';
    continuousContainer.style.display = continuousMode ? 'block' : 'none';

    if (!currentFileId) return;

    if (continuousMode) {
        await loadAllChapters(savedScrollPos);
        // loadAllChapters 내부 tryRestoreScroll에서 visibility 복원
    } else {
        await goToChapter(currentChapterIndex);
        // 단일 모드: iframe 로드 후 스크롤 복원
        if (savedScrollPos > 0) {
            iframe.onload = () => {
                setupIframeContent(iframe);
                if (iframe.contentWindow) {
                    iframe.contentWindow.scrollTo(0, savedScrollPos);
                }
                iframe.style.visibility = 'visible';
            };
        } else {
            // 스크롤 복원 불필요 → onload 후 즉시 보이기
            const origOnload = iframe.onload;
            iframe.onload = () => {
                if (origOnload) origOnload();
                iframe.style.visibility = 'visible';
            };
        }
    }
}

async function loadAllChapters(scrollOffset) {
    if (!currentFileId) return;

    const scrollTarget = currentChapterIndex;
    const extraOffset = scrollOffset || 0;
    chapterLabel.textContent = '전체';

    // 이전 상태 정리
    continuousContainer.removeEventListener('scroll', trackChapterOnScroll);
    continuousContainer.innerHTML = '';
    if (chapterObserver) chapterObserver.disconnect();
    renderedChapters.clear();

    // Phase 1: 모든 챕터의 경량 placeholder 즉시 생성 (~수 ms)
    for (let i = 0; i < totalChapters; i++) {
        const title = chapters[i] ? chapters[i].title : ('Chapter ' + (i + 1));

        const divider = document.createElement('div');
        divider.id = 'epub-ch-' + i;
        divider.dataset.chapter = i;
        if (i > 0) {
            divider.className = 'epub-chapter-divider';
            divider.innerHTML = '<span>' + escapeHtml(title) + '</span>';
        }
        continuousContainer.appendChild(divider);

        const wrapper = document.createElement('div');
        wrapper.className = 'epub-chapter-wrapper';
        wrapper.dataset.chapterIndex = i;
        wrapper.style.minHeight = CHAPTER_ESTIMATED_HEIGHT + 'px';
        continuousContainer.appendChild(wrapper);
    }

    // Phase 2: 대상 챕터를 먼저 로드하고 렌더링 완료 대기
    // (플레이스홀더 높이 기반 근사 스크롤 대신, 실제 렌더링 후 정확한 위치로 이동)
    pendingScrollRestore = null;
    const targetWrapper = continuousContainer.querySelector('[data-chapter-index="' + scrollTarget + '"]');
    if (targetWrapper) {
        // 근사 위치로 우선 이동 (IntersectionObserver가 주변 챕터를 감지하도록)
        continuousContainer.scrollTop = targetWrapper.offsetTop;
        renderedChapters.add(scrollTarget);
        await loadChapterAndWait(targetWrapper, scrollTarget);
    }

    // Phase 3: 대상 챕터 로드 완료 후 정확한 스크롤 위치 설정
    if (targetWrapper) {
        continuousContainer.scrollTop = targetWrapper.offsetTop + extraOffset;
    }
    continuousContainer.style.visibility = 'visible';
    hideLoading();

    // Phase 4: IntersectionObserver로 나머지 챕터 레이지 로딩
    chapterLoadQueue = [];
    activeChapterLoads = 0;
    chapterObserver = new IntersectionObserver(handleChapterIntersect, {
        root: continuousContainer,
        rootMargin: '200px 0px',
    });
    continuousContainer.querySelectorAll('.epub-chapter-wrapper').forEach(w => {
        chapterObserver.observe(w);
    });

    // 스크롤 시 현재 챕터 추적
    continuousContainer.addEventListener('scroll', trackChapterOnScroll);
}

function handleChapterIntersect(entries) {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = parseInt(entry.target.dataset.chapterIndex, 10);
        if (renderedChapters.has(index)) continue;
        renderedChapters.add(index);
        enqueueChapterLoad(entry.target, index);
    }
}

function enqueueChapterLoad(wrapper, index) {
    chapterLoadQueue.push({ wrapper, index });
    processChapterLoadQueue();
}

function processChapterLoadQueue() {
    while (activeChapterLoads < MAX_CONCURRENT_CHAPTER_LOADS && chapterLoadQueue.length > 0) {
        const { wrapper, index } = chapterLoadQueue.shift();
        activeChapterLoads++;
        renderLazyChapter(wrapper, index).then(() => {
            activeChapterLoads--;
            processChapterLoadQueue();
        });
    }
}

/**
 * 챕터를 로드하고 iframe 렌더링 완료까지 대기 (모드 전환 시 정확한 위치 설정용)
 */
async function loadChapterAndWait(wrapper, index) {
    try {
        const html = await invoke('get_epub_chapter', { fileId: currentFileId, chapterIndex: index });
        const baseStyles = getBaseStyles();
        const chIframe = document.createElement('iframe');
        chIframe.className = 'epub-chapter-frame';
        chIframe.style.cssText = 'width:100%;border:none;display:block;overflow:hidden;';
        const srcdoc = buildSrcdoc(baseStyles, sanitizeHtml(html));

        await new Promise((resolve) => {
            chIframe.onload = () => {
                setupIframeContent(chIframe);
                resizeIframeToContent(chIframe);
                wrapper.style.minHeight = '0';
                if (zoomLevel !== 100 && chIframe.contentDocument && chIframe.contentDocument.body) {
                    chIframe.contentDocument.body.style.zoom = (zoomLevel / 100).toString();
                    resizeIframeToContent(chIframe);
                }
                resolve();
            };
            chIframe.srcdoc = srcdoc;
            wrapper.appendChild(chIframe);
        });
    } catch {
        wrapper.style.minHeight = '0';
    }
}

async function renderLazyChapter(wrapper, index) {
    try {
        const html = await invoke('get_epub_chapter', { fileId: currentFileId, chapterIndex: index });
        const baseStyles = getBaseStyles();

        const chIframe = document.createElement('iframe');
        chIframe.className = 'epub-chapter-frame';
        chIframe.style.cssText = 'width:100%;border:none;display:block;overflow:hidden;';
        wrapper.appendChild(chIframe);

        const srcdoc = buildSrcdoc(baseStyles, sanitizeHtml(html));
        chIframe.srcdoc = srcdoc;

        chIframe.onload = () => {
            setupIframeContent(chIframe);

            const applyResize = () => {
                // 뷰포트 위 챕터의 높이 변경 시 스크롤 보정
                const oldH = wrapper.offsetHeight;
                const aboveViewport = wrapper.offsetTop + oldH <= continuousContainer.scrollTop;

                resizeIframeToContent(chIframe);
                wrapper.style.minHeight = '0';

                if (aboveViewport) {
                    const diff = wrapper.offsetHeight - oldH;
                    if (diff !== 0) {
                        continuousContainer.scrollTop += diff;
                    }
                }

                // 현재 줌 레벨 적용
                if (zoomLevel !== 100 && chIframe.contentDocument && chIframe.contentDocument.body) {
                    chIframe.contentDocument.body.style.zoom = (zoomLevel / 100).toString();
                    resizeIframeToContent(chIframe);
                }
            };

            const restoreScroll = () => {
                if (pendingScrollRestore && index === pendingScrollRestore.chapter) {
                    const w = continuousContainer.querySelector('[data-chapter-index="' + index + '"]');
                    if (w) {
                        continuousContainer.scrollTop = w.offsetTop + pendingScrollRestore.offset;
                    }
                    pendingScrollRestore = null;
                }
            };

            // 1차: onload 시점 리사이즈 + 스크롤 복원
            applyResize();
            restoreScroll();

            // 2차: 폰트 로딩 완료 후 리사이즈 + 스크롤 재조정
            const doc = chIframe.contentDocument;
            if (doc && doc.fonts && doc.fonts.ready) {
                doc.fonts.ready.then(() => {
                    resizeIframeToContent(chIframe);
                    // 폰트 로딩으로 높이 변경 시 위치 재보정
                    if (pendingScrollRestore && index === pendingScrollRestore.chapter) {
                        restoreScroll();
                    }
                });
            }
        };
    } catch {
        wrapper.style.minHeight = '0';
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
    // 대상 챕터가 아직 로드 안 됐으면 즉시 로드
    const wrapper = continuousContainer.querySelector('[data-chapter-index="' + index + '"]');
    if (wrapper && !renderedChapters.has(index)) {
        renderedChapters.add(index);
        renderLazyChapter(wrapper, index);
    }
}

function trackChapterOnScroll() {
    if (!continuousMode || !continuousContainer) return;

    // divider의 offsetTop과 scrollTop을 비교하여 현재 챕터 판별
    // (wrapper는 divider 아래에 위치하므로 divider 기준이 정확)
    const dividers = continuousContainer.querySelectorAll('[data-chapter]');
    const scrollTop = continuousContainer.scrollTop;

    let visibleChapter = 0;
    for (const div of dividers) {
        if (div.offsetTop <= scrollTop + 10) {
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

    // wheel 이벤트 명시적 처리: iframe 포커스 소실 시 스크롤 멈춤 방지
    // Chromium compositor가 비활성화되어 네이티브 스크롤이 멈추는 현상 우회
    doc.addEventListener('wheel', (e) => {
        if (continuousMode) {
            // 연속 모드: iframe은 overflow:hidden이므로 부모 컨테이너 스크롤
            continuousContainer.scrollTop += e.deltaY;
            e.preventDefault();
        } else {
            // 단일 모드: iframe 내부 document 스크롤
            f.contentWindow.scrollBy(0, e.deltaY);
            e.preventDefault();
        }
    }, { passive: false });

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
        hideLoading();
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
    if (chapterObserver) { chapterObserver.disconnect(); chapterObserver = null; }
    chapterLoadQueue = [];
    activeChapterLoads = 0;
    renderedChapters.clear();
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
        // 연속 모드: wrapper(콘텐츠 시작) 기준으로 직접 이동
        const wrapper = continuousContainer.querySelector('[data-chapter-index="' + index + '"]');
        if (wrapper) {
            continuousContainer.scrollTop = wrapper.offsetTop + (scrollPosition || 0);
            currentChapterIndex = index;
            chapterSelect.value = index;
            const chTitle = chapters[index] ? chapters[index].title : ('Chapter ' + (index + 1));
            chapterLabel.textContent = (index + 1) + ' / ' + totalChapters;
        }
        // 대상 챕터가 아직 로드 안 됐으면 즉시 로드
        if (wrapper && !renderedChapters.has(index)) {
            renderedChapters.add(index);
            renderLazyChapter(wrapper, index);
        }
    } else {
        // 스크롤 복원 필요 시 깜빡임 방지
        if (scrollPosition > 0) iframe.style.visibility = 'hidden';
        goToChapter(index).then(() => {
            if (scrollPosition > 0 && iframe) {
                // goToChapter의 onload가 scrollTop=0으로 초기화하므로
                // onload를 교체하여 저장된 위치로 스크롤 복원
                iframe.onload = () => {
                    setupIframeContent(iframe);
                    if (iframe.contentWindow) {
                        iframe.contentWindow.scrollTo(0, scrollPosition);
                    }
                    iframe.style.visibility = 'visible';
                    hideLoading();
                };
            }
        });
    }
}

export function getScrollPosition() {
    if (continuousMode && continuousContainer) {
        // 챕터 콘텐츠(wrapper) 시작 기준 상대 스크롤 위치
        const wrapper = continuousContainer.querySelector('[data-chapter-index="' + currentChapterIndex + '"]');
        if (wrapper) {
            return Math.max(0, Math.floor(continuousContainer.scrollTop - wrapper.offsetTop));
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
