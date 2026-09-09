/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    // 2026-09-09 (Fase 5, identidad BigMat): mismo cambio de marca (azul y
    // rojo corporativos reales de BigMat) que Backoffice y el resto de apps
    // -- ver frontend/tailwind.config.js para el detalle.
    extend: {
      colors: {
        brand: {
          50: "#f0f4f8",
          100: "#dee6f0",
          200: "#b8cadf",
          300: "#8eaacb",
          400: "#547eb1",
          500: "#21589a",
          600: "#03418c",
          700: "#023573",
          800: "#022c5f",
          900: "#02234c",
        },
        red: {
          50: "#fdf1f1",
          100: "#fbe2e1",
          200: "#f7c0bf",
          300: "#f29998",
          400: "#ec6563",
          500: "#e63835",
          600: "#e31d1a",
          700: "#ba1815",
          800: "#9a1412",
          900: "#7b100e",
        },
      },
    },
  },
  plugins: [],
};
