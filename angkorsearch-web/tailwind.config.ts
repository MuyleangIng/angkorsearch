import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        card:    'var(--color-card)',
        card2:   'var(--color-card2)',
        hover:   'var(--color-hover)',
        border:  'var(--color-border)',
        content: 'var(--color-text)',
        muted:   'var(--color-muted)',
        blue:    '#4285f4',
        green:   '#3fb950',
        red:     '#ea4335',
        yellow:  '#fbbc05',
        purple:  '#bc8cff',
        teal:    '#2dd4bf',
      },
      fontFamily: {
        sans:   ['Noto Sans', 'Noto Sans Khmer', 'system-ui', 'sans-serif'],
        khmer:  ['Noto Sans Khmer', 'sans-serif'],
      },
      animation: {
        shimmer:      'shimmer 1.5s ease-in-out infinite',
        'pulse-dot':  'pulseDot 1.5s ease-in-out infinite',
        'fade-in':    'fadeIn 0.3s ease',
        'slide-down': 'slideDown 0.2s ease',
      },
      keyframes: {
        shimmer: {
          '0%, 100%': { opacity: '0.4' },
          '50%':      { opacity: '0.8' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1',   transform: 'scale(1)' },
          '50%':      { opacity: '0.4', transform: 'scale(1.5)' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
