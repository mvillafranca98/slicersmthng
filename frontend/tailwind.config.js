/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          deepest: '#090B10',
          deep: '#0D1017',
          card: '#141820',
          elevated: '#1C2230',
        },
        primary: {
          DEFAULT: '#6C63FF',
          hover: '#8B85FF',
          glow: 'rgba(108, 99, 255, 0.35)',
        },
        accent: {
          cyan: '#00E5FF',
          amber: '#FFB347',
          red: '#FF4E6A',
        },
        stem: {
          vocals: '#FF6B8A',
          drums: '#FFB347',
          bass: '#00E5C3',
          guitar: '#5BDB6B',
          piano: '#C47FFF',
          other: '#8899AA',
          mytake: '#FFD166',
        },
        text: {
          primary: '#F0F4FF',
          secondary: '#8899BB',
          muted: '#4A5568',
          inverse: '#090B10',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'slide-up': 'slideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'fade-in': 'fadeIn 0.25s ease',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
