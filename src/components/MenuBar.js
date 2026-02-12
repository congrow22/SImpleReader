/**
 * MenuBar - Top menu bar with dropdown menus
 */

let activeMenu = null;
let onAction = null;

export function init(actionHandler) {
    onAction = actionHandler;

    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const menuName = item.dataset.menu;
            if (activeMenu === menuName) {
                closeMenus();
            } else {
                openMenu(item, menuName);
            }
        });

        item.addEventListener('mouseenter', () => {
            if (activeMenu && item.dataset.menu !== activeMenu) {
                openMenu(item, item.dataset.menu);
            }
        });
    });

    // Dropdown item clicks
    const dropdownItems = document.querySelectorAll('.menu-dropdown-item');
    dropdownItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            closeMenus();
            if (action && onAction) {
                onAction(action);
            }
        });
    });

    // Bookmark button
    document.getElementById('btn-bookmark').addEventListener('click', () => {
        if (onAction) onAction('add-bookmark');
    });

    // Settings button
    document.getElementById('btn-settings').addEventListener('click', () => {
        if (onAction) onAction('settings');
    });

    // Help button
    document.getElementById('btn-help').addEventListener('click', () => {
        if (onAction) onAction('help');
    });

    // Close menus on outside click
    document.addEventListener('click', () => {
        closeMenus();
    });

    // Prevent menu dropdown clicks from closing
    document.querySelectorAll('.menu-dropdown').forEach(dd => {
        dd.addEventListener('click', (e) => e.stopPropagation());
    });
}

function openMenu(element, menuName) {
    closeMenus();
    element.classList.add('active');
    activeMenu = menuName;
}

function closeMenus() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    activeMenu = null;
}

export function close() {
    closeMenus();
}
