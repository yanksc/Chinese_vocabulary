import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "Apple Color Emoji",
          "Segoe UI Emoji"
        ]
      },
      transitionTimingFunction: {
        crisp: "cubic-bezier(0.2, 0, 0, 1)"
      }
    }
  },
  plugins: []
};

export default config;
