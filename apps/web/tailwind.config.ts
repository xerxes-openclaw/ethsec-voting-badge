import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          red: { 500: "#FF3535" },
          blue: { 500: "#2C5EB6", 900: "#1E3A5F" },
          green: { 500: "#00ff88" },
          navy: { 950: "#152940" },
        },
        // DAO.fund public palette — matches thedao.fund/ethsecurity-badges
        dao: {
          blue: "#1F435F",
          "blue-hover": "#28567A",
          red: "#FF3535",
          "red-hover": "#E62D2D",
          green: "#00FF88",
        },
      },
      fontFamily: {
        sans: ["Inter Tight", "Inter", "system-ui", "sans-serif"],
        tight: ["Inter Tight", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
