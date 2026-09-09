/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    // 2026-09-09: mismo rediseño visual (acento ámbar) que Backoffice y el
    // resto de apps -- ver frontend/tailwind.config.js para el detalle.
    extend: {
      colors: {
        brand: {
          50: "#fdf6ec",
          100: "#fbebd3",
          200: "#f5d3a0",
          300: "#eebb6d",
          400: "#f2a33d",
          500: "#e08e22",
          600: "#c9791f",
          700: "#a35f18",
          800: "#7c4812",
          900: "#56330d",
        },
      },
    },
  },
  plugins: [],
};
