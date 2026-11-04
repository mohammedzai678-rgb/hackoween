import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        hydro: {
          950: "#040814",
          900: "#081024",
          800: "#0f1c3d",
          700: "#172d5e",
          500: "#0ea5e9",
          400: "#22d3ee",
          300: "#67e8f9",
        },
        surge: {
          amber: "#f59e0b",
          rose: "#f43f5e",
          emerald: "#10b981",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      backgroundImage: {
        "hydro-grid":
          "radial-gradient(circle at 1px 1px, rgba(34, 211, 238, 0.08) 1px, transparent 0)",
        "surge-glow":
          "radial-gradient(ellipse at top, rgba(14, 165, 233, 0.16), transparent 65%)",
      },
    },
  },
  plugins: [],
};

export default config;
