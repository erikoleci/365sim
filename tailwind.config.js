/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          header: '#126e51',
          headerDark: '#0e553f',
          bg: '#333333',
          panel: '#3b3b3b',
          text: '#e4e4e4',
          textMuted: '#a3a3a3',
          yellow: '#ffdf1b',
          accent: '#26ffbe',
          divider: '#4e4e4e',
        },
      },
      fontFamily: {
        sans: ['Verdana', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
