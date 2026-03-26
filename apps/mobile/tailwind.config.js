/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4 preset wires Tailwind to React Native StyleSheet
  presets: [require('nativewind/preset')],

  // Dark mode follows system preference by default via NativeWind's colorScheme
  darkMode: 'media',

  content: [
    './App.tsx',
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './navigation/**/*.{js,jsx,ts,tsx}',
    './theme/**/*.{js,jsx,ts,tsx}',
  ],

  theme: {
    extend: {
      colors: {
        // Map design tokens into Tailwind classes for future NativeWind usage.
        // Usage: className="bg-background dark:bg-background-dark"
        background: {
          DEFAULT: '#ffffff',
          dark:    '#000000',
        },
        surface: {
          DEFAULT: '#f8fafc',
          dark:    '#0d1117',
        },
        separator: {
          DEFAULT: '#e2e8f0',
          dark:    '#1e293b',
        },
        bullish: '#22c55e',
        bearish: '#ef4444',
        neutral: '#f59e0b',
      },
    },
  },
  plugins: [],
};
