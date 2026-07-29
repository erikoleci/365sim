/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Premium dark-first palette (Linear/Stripe-inspired neutrals +
        // a single emerald accent), replacing the flat bet365-green clone.
        brand: {
          bg: '#0b0e11',
          surface: '#12161b',
          surface2: '#171c22',
          surfaceHover: '#1d232b',
          border: '#242b33',
          header: '#0f1418',
          text: '#e8ecef',
          textMuted: '#8b95a1',
          textFaint: '#5b6572',
          accent: '#22e6a3',
          accentDark: '#12b384',
          accentSoft: 'rgba(34,230,163,0.12)',
          yellow: '#ffcc33',
          danger: '#ff5c72',
          live: '#ff3b5c',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        display: ['"Manrope"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl2: '0.875rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.24)',
        popover: '0 12px 32px rgba(0,0,0,0.45)',
      },
      keyframes: {
        pulseLive: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        pulseLive: 'pulseLive 1.4s ease-in-out infinite',
        fadeIn: 'fadeIn 0.18s ease-out',
      },
    },
  },
  plugins: [],
};
