/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        stream: {
          dark: "#090d16",
          card: "#0f172a",
          border: "#1e293b",
          primary: "#06b6d4",
          secondary: "#8b5cf6",
          accent: "#10b981",
          danger: "#f43f5e",
          warning: "#f59e0b"
        }
      },
      boxShadow: {
        glow: "0 0 25px -5px rgba(6, 182, 212, 0.3)",
        "glow-purple": "0 0 25px -5px rgba(139, 92, 246, 0.3)"
      }
    },
  },
  plugins: [],
}
