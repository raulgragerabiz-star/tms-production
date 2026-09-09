/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 2026-09-09 (Fase 5, identidad BigMat): sustituye el acento ámbar de
        // las Fases 1-4 por los colores corporativos reales de BigMat,
        // extraídos por muestreo de píxeles de su logotipo (azul #03418c,
        // rojo #e31d1a). Mismo mecanismo de siempre: se cambia solo la
        // paleta bajo los nombres ya usados en todo el código
        // ("brand-500/600/700" para azul de marca, y ahora también se
        // redefine la escala "red-*" de Tailwind con el rojo real de BigMat)
        // -- ningún fichero que ya usaba brand-* o red-* necesita tocarse,
        // adoptan el color nuevo automáticamente. El rojo se reutiliza tal
        // cual porque en todo el código ya se usaba exclusivamente para
        // alertas/incidencias/urgente/rechazado -- exactamente el uso que
        // pidió Raúl para "el tono del logotipo de BigMat".
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
