/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    // 2026-09-09: esta app no tenía todavía un color "brand" propio (usaba
    // "blue-*" de Tailwind directamente en cada página) -- se añade el mismo
    // acento ámbar que ya tienen Backoffice, Portal Transportista y App
    // Conductor, y se sustituyen esos usos de "blue-*" por "brand-*".
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
