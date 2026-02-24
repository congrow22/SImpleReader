/**
 * TabBar - File tab management
 */

import { invoke } from '@tauri-apps/api/core';

let tabs = [];
let activeTabId = null;
let onTabSwitch = null;
let onTabClose = null;
let onNewTab = null;

const tabList = document.getElementById('tab-list');
export function init({ onSwitch, onClose, onNew }) {
    onTabSwitch = onSwitch;
    onTabClose = onClose;
    onNewTab = onNew;
}

export function addTab(fileInfo) {
    // Check if tab already exists
    const existing = tabs.find(t => t.id === fileInfo.id);
    if (!existing) {
        const tab = {
            id: fileInfo.id,
            name: fileInfo.name,
            path: fileInfo.path,
            isModified: fileInfo.is_modified || false
        };
        tabs.push(tab);
    }

    // Only update visual state — openFile already handles file loading,
    // so we must NOT trigger onTabSwitch here to avoid a race condition.
    activeTabId = fileInfo.id;
    renderTabs();
}

export function removeTab(id) {
    const index = tabs.findIndex(t => t.id === id);
    if (index === -1) return;

    tabs.splice(index, 1);

    if (activeTabId === id) {
        if (tabs.length > 0) {
            const newIndex = Math.min(index, tabs.length - 1);
            switchTab(tabs[newIndex].id);
        } else {
            activeTabId = null;
            renderTabs();
            if (onTabSwitch) onTabSwitch(null);
        }
    } else {
        renderTabs();
    }
}

export function switchTab(id) {
    if (activeTabId === id) return;

    activeTabId = id;
    renderTabs();

    if (onTabSwitch) onTabSwitch(id);
}

export function updateTab(id, info) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;

    if (info.name !== undefined) tab.name = info.name;
    if (info.is_modified !== undefined) tab.isModified = info.is_modified;

    renderTabs();
}

export function getActiveTabId() {
    return activeTabId;
}

export function getTabCount() {
    return tabs.length;
}

export function getTabs() {
    return [...tabs];
}

export function nextTab() {
    if (tabs.length <= 1) return;
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    const nextIndex = (currentIndex + 1) % tabs.length;
    switchTab(tabs[nextIndex].id);
}

export function prevTab() {
    if (tabs.length <= 1) return;
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    switchTab(tabs[prevIndex].id);
}

function renderTabs() {
    // Clear all children safely
    while (tabList.firstChild) {
        tabList.removeChild(tabList.firstChild);
    }

    tabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.isModified ? ' modified' : '');
        el.dataset.id = tab.id;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tab-name';
        nameSpan.title = tab.path || tab.name;
        nameSpan.textContent = tab.name;

        const modifiedSpan = document.createElement('span');
        modifiedSpan.className = 'tab-modified';
        modifiedSpan.textContent = '*';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.title = '닫기';
        closeBtn.textContent = '\u00D7';

        el.appendChild(nameSpan);
        el.appendChild(modifiedSpan);
        el.appendChild(closeBtn);

        // Click to switch
        el.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                switchTab(tab.id);
            }
        });

        // Middle click to close
        el.addEventListener('mousedown', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                if (onTabClose) onTabClose(tab.id);
            }
        });

        // Close button
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onTabClose) onTabClose(tab.id);
        });

        tabList.appendChild(el);
    });
}
