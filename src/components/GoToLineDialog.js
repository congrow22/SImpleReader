/**
 * GoToLineDialog - Jump to specific line number
 */

let currentLine = 0;
let totalLines = 0;
let onGoToLine = null;

// DOM
const dialog = document.getElementById('goto-dialog');
const info = document.getElementById('goto-info');
const input = document.getElementById('goto-input');
const btnGo = document.getElementById('btn-goto-go');
const btnCancel = document.getElementById('btn-goto-cancel');
const btnClose = document.getElementById('btn-goto-close');

export function init(options = {}) {
    onGoToLine = options.onGoToLine || null;

    btnGo.addEventListener('click', goToLine);
    btnCancel.addEventListener('click', hide);
    btnClose.addEventListener('click', hide);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            goToLine();
        }
        if (e.key === 'Escape') {
            hide();
        }
    });

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) hide();
    });
}

export function show(current, total) {
    currentLine = current || 0;
    totalLines = total || 0;

    info.textContent = '\uD604\uC7AC \uC904: ' + currentLine.toLocaleString() + ' / \uC804\uCCB4: ' + totalLines.toLocaleString();
    input.value = '';
    input.max = totalLines;
    input.placeholder = '1 - ' + totalLines.toLocaleString();

    dialog.classList.remove('hidden');
    input.focus();
}

export function hide() {
    dialog.classList.add('hidden');
}

function goToLine() {
    const lineNum = parseInt(input.value, 10);
    if (isNaN(lineNum) || lineNum < 1 || lineNum > totalLines) {
        input.classList.add('error');
        setTimeout(() => input.classList.remove('error'), 500);
        return;
    }

    if (onGoToLine) onGoToLine(lineNum);
    hide();
}

export function isOpen() {
    return !dialog.classList.contains('hidden');
}
