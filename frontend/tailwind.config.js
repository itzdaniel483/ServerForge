/** @type {import('tailwindcss').Config} */
// UI v2 theme (claude, 2026-10-30). Every colour comes from CSS variables in src/themes.css, so a
// palette is picked at runtime (html[data-theme]). gray = tinted neutrals, accent = main colour,
// accent2 = highlight. Old names (ember, blue, indigo...) map to accent so every screen follows the theme.
const ramp = (v, keys = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) =>
    Object.fromEntries(keys.map(k => [k, `rgb(var(--${v}-${k}) / <alpha-value>)`]));
const gray = ramp('g');
const accent = ramp('a');
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            colors: {
                gray, slate: gray, accent, ember: accent, blue: accent, indigo: accent, cyan: accent, purple: accent,
                accent2: ramp('b', [300, 400, 500]),
                go: { 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 500: '#16a34a', 600: '#15803d' },
                stop: { 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#dc2626', 600: '#b91c1c' },
                warn: { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b' },
            },
            fontFamily: {
                sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
            },
            boxShadow: {
                glow: '0 0 0 1px rgb(var(--a-400) / .35), 0 8px 32px -8px rgb(var(--a-500) / .45)',
                card: '0 1px 0 0 rgb(255 255 255 / .04) inset, 0 12px 32px -16px rgb(0 0 0 / .6)',
            },
        },
    },
    plugins: [],
};
