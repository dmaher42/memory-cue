/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./**/*.html"],
  theme: {
    extend: {},
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        professional: {
          primary: "#4f46e5",
          secondary: "#fcd34d",
          accent: "#f472b6",
          neutral: "#3d4451",
          "base-100": "#ffffff",
          info: "#3abff8",
          success: "#36d399",
          warning: "#fbbd23",
          error: "#f87272",
        },
      },
      "light",
      "dark",
    ],
  },
};
