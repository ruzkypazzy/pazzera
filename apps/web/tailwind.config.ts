import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1280px' },
    },
    extend: {
      colors: {
        bg: {
          DEFAULT: 'hsl(var(--bg))',
          elevated: 'hsl(var(--bg-elevated))',
          muted: 'hsl(var(--bg-muted))',
        },
        fg: {
          DEFAULT: 'hsl(var(--fg))',
          muted: 'hsl(var(--fg-muted))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          fg: 'hsl(var(--accent-fg))',
        },
        border: 'hsl(var(--border))',
        ring: 'hsl(var(--ring))',
        danger: 'hsl(var(--danger))',
        success: 'hsl(var(--success))',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
        pulse: 'pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;