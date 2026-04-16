import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          red: { 500: "#FF3535" },
          blue: { 500: "#2C5EB6", 900: "#1E3A5F" },
          green: { 500: "#5CB75A" },
          navy: { 950: "#152940" },
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        tight: ["Inter Tight", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
