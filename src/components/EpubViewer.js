/**
 * EpubViewer - EPUB chapter-based HTML renderer (iframe approach)
 * Uses iframe srcdoc for complete document isolation, like Calibre.
 * This ensures body{} CSS selectors and @font-face work naturally.
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

// DOM elements
const container = document.getElementById('epub-viewer-container');
const chapterSelect = document.getElementById('epub-chapter-select');
const chapterLabel = document.getElementById('epub-chapter-label');
const btnPrev = document.getElementById('epub-btn-prev');
const btnNext = document.getElementById('epub-btn-next');
const contentArea = document.getElementById('epub-content');

// iframe for rendering EPUB chapters
let iframe = null;

export function init(options = {}) {
    onChapterChange = options.onChapterChange || null;

    // Create iframe for EPUB rendering (replaces Shadow DOM)
    iframe = document.createElement('iframe');
    iframe.id = 'epub-iframe';
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    contentArea.appendChild(iframe);

    btnPrev.addEventListener('click', () => goToChapter(currentChapterIndex - 1));
    btnNext.addEventListener('click', () => goToChapter(currentChapterIndex + 1));

    chapterSelect.addEventListener('change', () => {
        const idx = parseInt(chapterSelect.value, 10);
        if (!isNaN(idx)) goToChapter(idx);
    });

    // Keyboard navigation on container (when iframe doesn't have focus)
    contentArea.addEventListener('keydown', handleKeydown);
}

function handleKeydown(e) {
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
    // These contain deobfuscated font data as base64, built by Rust.
    try {
        fontStylesCss = await invoke('get_epub_font_styles', { fileId: currentFileId });
    } catch {
        fontStylesCss = '';
    }

    show();
    await goToChapter(currentChapterIndex);
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
        renderChapterInIframe(html);
    } catch {
        renderChapterInIframe('<p style="color:red;padding:16px;">챕터를 불러올 수 없습니다.</p>');
    }

    if (onChapterChange) {
        onChapterChange(currentChapterIndex, totalChapters, chTitle);
    }
}

/**
 * Build a complete HTML document and render in iframe via srcdoc.
 * This approach mirrors Calibre: a complete document context ensures
 * body{} selectors and @font-face work naturally without Shadow DOM hacks.
 */
function renderChapterInIframe(chapterHtml) {
    const sanitized = sanitizeHtml(chapterHtml);

    // Read CSS variable values from parent document for theming
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

    // Build complete HTML document.
    // Font @font-face goes in <head> (loaded once from cached fontStylesCss).
    // Chapter HTML (with its own <style> + body content) goes in <body>.
    // The EPUB's body{font-family:'CustomFont'} overrides our base font
    // due to later source order, which is the correct behavior.
    const srcdoc = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n' +
        '<style>\n' + fontStylesCss + '\n</style>\n' +
        '<style>\n' +
        'html, body { margin: 0; padding: 24px 32px;' +
        ' background: ' + bgColor + ';' +
        ' color: ' + textColor + ';' +
        ' font-family: ' + fontFamily + ';' +
        ' font-size: ' + fontSize + ';' +
        ' font-weight: ' + fontWeight + ';' +
        ' line-height: 1.7;' +
        ' word-wrap: break-word;' +
        ' overflow-wrap: break-word; }\n' +
        'img { max-width: 100%; height: auto; display: block; margin: 12px auto; }\n' +
        'h1,h2,h3,h4,h5,h6 { color: ' + textHighlight + '; margin: 1em 0 0.5em; line-height: 1.3; }\n' +
        'p { margin: 0.5em 0; }\n' +
        'a { color: ' + textAccent + '; text-decoration: none; }\n' +
        'a:hover { text-decoration: underline; }\n' +
        'blockquote { border-left: 3px solid ' + accentColor + '; padding-left: 16px; margin: 1em 0; color: ' + textSecondary + '; }\n' +
        'table { border-collapse: collapse; margin: 1em 0; width: 100%; }\n' +
        'th, td { border: 1px solid ' + borderColor + '; padding: 6px 10px; text-align: left; }\n' +
        'th { background: ' + bgSecondary + '; }\n' +
        'hr { border: none; border-top: 1px solid ' + borderColor + '; margin: 1.5em 0; }\n' +
        '</style>\n</head>\n<body>\n' +
        sanitized + '\n</body>\n</html>';

    iframe.srcdoc = srcdoc;

    // After iframe loads, set up event handlers
    iframe.onload = () => {
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) return;

        // Disable external links
        const links = iframeDoc.querySelectorAll('a[href]');
        links.forEach(link => {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('#')) {
                link.addEventListener('click', (e) => e.preventDefault());
            }
        });

        // Forward keyboard events for chapter navigation
        iframeDoc.addEventListener('keydown', handleKeydown);

        // Scroll to top of new chapter
        iframeDoc.documentElement.scrollTop = 0;
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

export function isVisible() {
    return !container.classList.contains('hidden');
}
