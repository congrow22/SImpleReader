/**
 * SettingsDialog - Application settings modal
 */

import { invoke } from '@tauri-apps/api/core';

let currentConfig = null;
let onApply = null;
let fontsLoaded = false;

// DOM
const dialog = document.getElementById('settings-dialog');
const fontFamily = document.getElementById('setting-font-family');
const fontSize = document.getElementById('setting-font-size');
const fontSizeValue = document.getElementById('setting-font-size-value');
const themeSelect = document.getElementById('setting-theme');
const fontBold = document.getElementById('setting-font-bold');
const wordWrap = document.getElementById('setting-word-wrap');
const contextMenu = document.getElementById('setting-context-menu');
const btnApply = document.getElementById('btn-settings-apply');
const btnCancel = document.getElementById('btn-settings-cancel');
const btnClose = document.getElementById('btn-settings-close');

export function init(options = {}) {
    onApply = options.onApply || null;

    fontSize.addEventListener('input', () => {
        fontSizeValue.textContent = fontSize.value;
    });

    fontFamily.addEventListener('change', () => {
        const selected = fontFamily.options[fontFamily.selectedIndex];
        fontFamily.title = selected ? selected.textContent : '';
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

async function loadSystemFonts() {
    if (fontsLoaded) return;
    try {
        const fonts = await invoke('get_system_fonts');
        while (fontFamily.firstChild) {
            fontFamily.removeChild(fontFamily.firstChild);
        }

        const defaultOpt = document.createElement('option');
        defaultOpt.value = 'monospace';
        defaultOpt.textContent = '시스템 모노스페이스';
        fontFamily.appendChild(defaultOpt);

        for (const name of fonts) {
            const opt = document.createElement('option');
            opt.value = "'" + name + "'";
            opt.textContent = name;
            opt.title = name;
            opt.style.fontFamily = "'" + name + "'";
            fontFamily.appendChild(opt);
        }
        fontsLoaded = true;
    } catch (err) {
        console.error('Failed to load system fonts:', err);
    }
}

export async function show() {
    await loadSystemFonts();

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
    const selectedOpt = fontFamily.options[fontFamily.selectedIndex];
    fontFamily.title = selectedOpt ? selectedOpt.textContent : '';

    fontSize.value = currentConfig.font_size || 16;
    fontSizeValue.textContent = fontSize.value;

    themeSelect.value = currentConfig.theme || 'dark';
    fontBold.checked = currentConfig.font_bold || false;
    wordWrap.checked = currentConfig.word_wrap || false;

    // Check context menu registration status
    try {
        contextMenu.checked = await invoke('is_context_menu_registered');
    } catch (e) {
        contextMenu.checked = false;
    }

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
        font_bold: fontBold.checked,
        word_wrap: wordWrap.checked
    });

    try {
        await invoke('save_config', { config });
        currentConfig = config;

        // Handle context menu registration
        try {
            const isRegistered = await invoke('is_context_menu_registered');
            if (contextMenu.checked && !isRegistered) {
                await invoke('register_context_menu');
            } else if (!contextMenu.checked && isRegistered) {
                await invoke('unregister_context_menu');
            }
        } catch (e) {
            console.error('Failed to update context menu:', e);
        }

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
