/**
 * SettingsDialog - Application settings modal
 */

import { invoke } from '@tauri-apps/api/core';

let currentConfig = null;
let onApply = null;

// DOM
const dialog = document.getElementById('settings-dialog');
const fontFamily = document.getElementById('setting-font-family');
const fontSize = document.getElementById('setting-font-size');
const fontSizeValue = document.getElementById('setting-font-size-value');
const themeSelect = document.getElementById('setting-theme');
const fontBold = document.getElementById('setting-font-bold');
const btnApply = document.getElementById('btn-settings-apply');
const btnCancel = document.getElementById('btn-settings-cancel');
const btnClose = document.getElementById('btn-settings-close');

export function init(options = {}) {
    onApply = options.onApply || null;

    fontSize.addEventListener('input', () => {
        fontSizeValue.textContent = fontSize.value;
    });

    btnApply.addEventListener('click', applySettings);
    btnCancel.addEventListener('click', hide);
    btnClose.addEventListener('click', hide);

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) hide();
    });

    dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hide();
    });
}

export async function show() {
    try {
        currentConfig = await invoke('get_config');
    } catch (err) {
        console.error('Failed to load config:', err);
        currentConfig = {
            font_family: "'Consolas', monospace",
            font_size: 16,
            theme: 'dark'
        };
    }

    if (currentConfig.font_family) {
        const options = fontFamily.options;
        let matched = false;
        for (let i = 0; i < options.length; i++) {
            if (options[i].value === currentConfig.font_family) {
                fontFamily.selectedIndex = i;
                matched = true;
                break;
            }
        }
        if (!matched) {
            fontFamily.selectedIndex = 0;
        }
    }

    fontSize.value = currentConfig.font_size || 16;
    fontSizeValue.textContent = fontSize.value;

    themeSelect.value = currentConfig.theme || 'dark';
    fontBold.checked = currentConfig.font_bold || false;

    dialog.classList.remove('hidden');
}

export function hide() {
    dialog.classList.add('hidden');
}

async function applySettings() {
    const config = Object.assign({}, currentConfig || {}, {
        font_family: fontFamily.value,
        font_size: parseInt(fontSize.value, 10),
        theme: themeSelect.value,
        font_bold: fontBold.checked
    });

    try {
        await invoke('save_config', { config });
        currentConfig = config;

        if (onApply) {
            onApply(config);
        }

        hide();
    } catch (err) {
        console.error('Failed to save config:', err);
    }
}

export function isOpen() {
    return !dialog.classList.contains('hidden');
}
