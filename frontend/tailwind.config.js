/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 2026-09-09: rediseño visual pedido por Raúl a partir de un panel de
        // referencia (TMS Getafe) -- acento ámbar en vez de azul. Se cambia
        // solo la paleta (los mismos nombres brand-500/600/700 que ya se
        // usaban en 24 ficheros), así todo botón/enlace/foco que ya usaba
        // "brand-*" adopta el nuevo color sin tocar cada fichero uno a uno.
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
