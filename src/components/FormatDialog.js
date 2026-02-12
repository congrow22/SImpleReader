/**
 * FormatDialog - Text formatting dialog
 */

import { invoke } from '@tauri-apps/api/core';

let currentFileId = null;
let selectedFormat = null;
let onFormatApplied = null;

// DOM
const dialog = document.getElementById('format-dialog');
const preview = document.getElementById('format-preview');
const previewContent = document.getElementById('format-preview-content');
const btnApply = document.getElementById('btn-format-apply');
const btnCancel = document.getElementById('btn-format-cancel');
const btnClose = document.getElementById('btn-format-close');
const formatButtons = document.querySelectorAll('.format-option-btn');

export function init(options = {}) {
    onFormatApplied = options.onFormatApplied || null;

    formatButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            selectFormat(btn.dataset.format);
        });
    });

    btnApply.addEventListener('click', applyFormat);
    btnCancel.addEventListener('click', hide);
    btnClose.addEventListener('click', hide);

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) hide();
    });

    dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hide();
    });
}

export function show(fileId) {
    currentFileId = fileId;
    selectedFormat = null;

    formatButtons.forEach(btn => btn.classList.remove('selected'));
    preview.classList.add('hidden');
    btnApply.classList.add('hidden');
    previewContent.textContent = '';

    dialog.classList.remove('hidden');
}

export function hide() {
    dialog.classList.add('hidden');
    selectedFormat = null;
}

async function selectFormat(formatType) {
    selectedFormat = formatType;

    formatButtons.forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.format === formatType);
    });

    if (!currentFileId) return;

    try {
        const previewData = await invoke('preview_format', {
            fileId: currentFileId,
            formatType: formatType
        });

        previewContent.textContent = typeof previewData === 'string'
            ? previewData
            : JSON.stringify(previewData, null, 2);

        preview.classList.remove('hidden');
        btnApply.classList.remove('hidden');
    } catch (err) {
        console.error('Preview failed:', err);
        previewContent.textContent = '\uBBF8\uB9AC\uBCF4\uAE30\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.';
        preview.classList.remove('hidden');
        btnApply.classList.add('hidden');
    }
}

async function applyFormat() {
    if (!selectedFormat || !currentFileId) return;

    try {
        await invoke('apply_format', {
            fileId: currentFileId,
            formatType: selectedFormat
        });

        if (onFormatApplied) onFormatApplied();
        hide();
    } catch (err) {
        console.error('Format apply failed:', err);
    }
}

export function isOpen() {
    return !dialog.classList.contains('hidden');
}
