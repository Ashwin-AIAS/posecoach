/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark athletic-tech surfaces (near-black → raised card → hairline border)
        surface: {
          base: "#0A0B0D",
          raised: "#15171C",
          overlay: "#1B1E24",
          hairline: "#23262D",
        },
        // Single electric accent, driven by a CSS var so it is swappable in one place.
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          soft: "rgb(var(--accent) / 0.15)",
        },
        // Live form-score semantics: red → amber → green ramp.
        score: {
          bad: "#FF4D4D",
          mid: "#FFB23D",
          good: "#36D399",
        },
      },
      fontFamily: {
        display: ['"Space Grotesk Variable"', "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--accent) / 0.55), 0 0 22px -4px rgb(var(--accent) / 0.5)",
        "glow-sm": "0 0 0 1px rgb(var(--accent) / 0.4), 0 0 12px -4px rgb(var(--accent) / 0.4)",
        card: "0 8px 30px -12px rgba(0, 0, 0, 0.7)",
      },
      keyframes: {
        "caption-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "caption-in": "caption-in 0.25s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        "scale-in": "scale-in 0.18s ease-out",
        "pulse-dot": "pulse-dot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
}
