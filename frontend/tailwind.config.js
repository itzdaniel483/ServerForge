/** @type {import('tailwindcss').Config} */
// Overhaul theme (claude, 2026-10-30). gray = high-contrast cool neutrals; blue is remapped to the
// ember accent so older screens that still use blue-* pick up the new look; go = online, stop = danger.
const ember = { 50: '#fff4ec', 100: '#ffe3cc', 200: '#ffc799', 300: '#ffa766', 400: '#ff8a3d', 500: '#e8590c', 600: '#c4470a', 700: '#a03a08', 800: '#7a2c06', 900: '#5c2105', 950: '#331203' };
const gray = { 50: '#f8fafc', 100: '#f1f4f8', 200: '#e3e8ef', 300: '#cfd6e1', 400: '#aeb8c7', 500: '#8a95a8', 600: '#5d6779', 700: '#353d4c', 800: '#1d232e', 900: '#131821', 950: '#0a0d12' };
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            colors: {
                gray, slate: gray, ember, blue: ember, indigo: ember, cyan: ember, purple: ember,
                go: { 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 500: '#16a34a', 600: '#15803d' },
                stop: { 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#dc2626', 600: '#b91c1c' },
            },
            fontFamily: {
                sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
            },
        },
    },
    plugins: [],
};
