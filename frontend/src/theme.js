// Runtime palettes (claude, UI v2). Colours live in themes.css; this picks one and remembers it.
export const THEMES = [
    { id: 'steel', label: 'Steel', swatch: ['#3b82f6', '#a78bfa'] },   // default: Daniel's pick, 2026-10-30
    { id: 'nebula', label: 'Nebula', swatch: ['#8b5cf6', '#22d3ee'] },
    { id: 'aurora', label: 'Aurora', swatch: ['#14b8a6', '#38bdf8'] },
    { id: 'ember', label: 'Ember', swatch: ['#e8590c', '#fbbf24'] },
];

// Only an explicit pick is stored (key 'sf-theme'; the old 'theme' key was written on every load,
// so it can't tell a choice from the old default and is ignored).
export function getTheme() {
    const saved = localStorage.getItem('sf-theme');
    return THEMES.some(t => t.id === saved) ? saved : THEMES[0].id;
}

export function applyTheme(id = getTheme(), remember = false) {
    document.documentElement.dataset.theme = id;
    if (remember) localStorage.setItem('sf-theme', id);
    window.dispatchEvent(new Event('serverforge:theme'));
}

// A theme colour as a CSS colour string, for things outside Tailwind (xterm, SVG).
export function themeColor(name, alpha = 1) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    return `rgb(${v.split(/\s+/).join(',')}${alpha < 1 ? `,${alpha}` : ''})`.replace('rgb(', alpha < 1 ? 'rgba(' : 'rgb(');
}
