const { invoke } = window.__TAURI__.core;

async function greet() {
    const result = await invoke('greet', { name: 'World' });
    console.log(result);
}

document.addEventListener('DOMContentLoaded', () => {
    greet();
});
