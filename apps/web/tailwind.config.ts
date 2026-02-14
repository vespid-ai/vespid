import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular"],
      },
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        panelElev: "rgb(var(--panel-elev) / <alpha-value>)",
        surface0: "rgb(var(--surface-0) / <alpha-value>)",
        surface1: "rgb(var(--surface-1) / <alpha-value>)",
        surface2: "rgb(var(--surface-2) / <alpha-value>)",
        surface3: "rgb(var(--surface-3) / <alpha-value>)",
        surfaceGlass: "rgb(var(--surface-glass) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        borderSubtle: "rgb(var(--border-subtle) / <alpha-value>)",
        borderStrong: "rgb(var(--border-strong) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        brandContrast: "rgb(var(--brand-contrast) / <alpha-value>)",
        focus: "rgb(var(--focus) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
      },
      boxShadow: {
        elev1: "var(--shadow-1)",
        elev2: "var(--shadow-2)",
        elev3: "var(--shadow-3)",
        panel: "var(--shadow-2)",
        inset: "var(--shadow-inset)",
      },
      borderRadius: {
        lg: "14px",
        md: "12px",
        sm: "10px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 220ms ease-out",
      },
    },
  },
} satisfies Config;
