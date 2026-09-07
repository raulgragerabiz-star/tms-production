/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: { colors: { brand: { 500: "#3760ff", 600: "#2a4cdb", 700: "#233eb0" } } },
  },
  plugins: [],
};
