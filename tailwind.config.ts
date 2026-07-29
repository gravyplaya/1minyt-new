import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0c',
        surface: '#15151a',
        surface2: '#1f1f26',
        border: '#2a2a33',
        text: '#e7e7ea',
        muted: '#8b8b94',
        accent: '#5b9eff',
        accent2: '#7c5cff',
        danger: '#ff6363',
        warn: '#ffb84d',
        ok: '#5cd9a3',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;