/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./mobile.html",
    "./src/**/*.{html,js,ts,jsx,tsx}",
    "./js/**/*.{js,ts}",
    "./mobile.js",
  ],
  theme: {
    extend: {},
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: ["light", "dark"], // add more later if desired
  },
};
