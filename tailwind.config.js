/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // MetricCard builds `bg-<color>-50` from a prop at runtime.
  safelist: [{ pattern: /^bg-(slate|gray|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-50$/ }],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        heading: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        serif: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      colors: {
        control: { light: '#F8FAFC', card: '#FFFFFF', cardHover: '#F1F5F9', border: '#E2E8F0' }
      }
    }
  }
};
