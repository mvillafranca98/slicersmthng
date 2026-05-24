/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          deepest: '#0B0D11',
          deep: '#0F1219',
          card: '#161A24',
          elevated: '#1D2230',
        },
        primary: {
          // Studio Amber — warm amber, deliberately offset from the drums
          // stem color (#FFB347) so they don't get confused in the UI.
          DEFAULT: '#FFA94D',
          hover: '#FFC078',
          glow: 'rgba(255, 169, 77, 0.38)',
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
          inverse: '#0B0D11',
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
