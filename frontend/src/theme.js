// Runtime palettes (claude, UI v2). Colours live in themes.css; this picks one and remembers it.
export const THEMES = [
    { id: 'nebula', label: 'Nebula', swatch: ['#8b5cf6', '#22d3ee'] },
    { id: 'aurora', label: 'Aurora', swatch: ['#14b8a6', '#38bdf8'] },
    { id: 'steel', label: 'Steel', swatch: ['#3b82f6', '#a78bfa'] },
    { id: 'ember', label: 'Ember', swatch: ['#e8590c', '#fbbf24'] },
];

export function getTheme() {
    const saved = localStorage.getItem('theme');
    return THEMES.some(t => t.id === saved) ? saved : THEMES[0].id;
}

export function applyTheme(id = getTheme()) {
    document.documentElement.dataset.theme = id;
    localStorage.setItem('theme', id);
    window.dispatchEvent(new Event('serverforge:theme'));
}

// A theme colour as a CSS colour string, for things outside Tailwind (xterm, SVG).
export function themeColor(name, alpha = 1) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    return `rgb(${v.split(/\s+/).join(',')}${alpha < 1 ? `,${alpha}` : ''})`.replace('rgb(', alpha < 1 ? 'rgba(' : 'rgb(');
}
