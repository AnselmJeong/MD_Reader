/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Source Serif 4"', '"Noto Serif KR"', 'Georgia', 'serif'],
        sans: ['Inter', '"Noto Sans KR"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      colors: {
        surface: 'var(--color-surface)',
        'surface-alt': 'var(--color-surface-alt)',
        'on-surface': 'var(--color-on-surface)',
        'on-surface-muted': 'var(--color-on-surface-muted)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        border: 'var(--color-border)',
        'chat-bg': 'var(--color-chat-bg)',
        'chat-user': 'var(--color-chat-user)',
        'chat-ai': 'var(--color-chat-ai)',
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: '72ch',
            lineHeight: '1.75',
          },
        },
      },
    },
  },
  plugins: [],
}
