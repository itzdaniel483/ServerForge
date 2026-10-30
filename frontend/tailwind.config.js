/** @type {import('tailwindcss').Config} */
// UI v3 theme (claude, 2026-10-30): flat control-panel look. Small fixed radii (no bubbles), no glows.
// Colours as UI v2: Every colour comes from CSS variables in src/themes.css, so a
// palette is picked at runtime (html[data-theme]). gray = tinted neutrals, accent = main colour,
// accent2 = highlight. Old names (ember, blue, indigo...) map to accent so every screen follows the theme.
const ramp = (v, keys = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) =>
    Object.fromEntries(keys.map(k => [k, `rgb(var(--${v}-${k}) / <alpha-value>)`]));
const gray = ramp('g');
const accent = ramp('a');
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        // Replaces Tailwind's radii: everything tops out at 6px except true circles (rounded-full).
        borderRadius: { none: '0', sm: '2px', DEFAULT: '3px', md: '4px', lg: '4px', xl: '5px', '2xl': '6px', '3xl': '6px', full: '9999px' },
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
                glow: 'none',
                card: 'none',
            },
        },
    },
    plugins: [],
};
