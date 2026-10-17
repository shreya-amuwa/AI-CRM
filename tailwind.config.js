/**
 * The shared design language of every dashboard (the Department Head design handoff):
 *  - neutral greys instead of blue-grey slate, a calm indigo-blue accent with tinted active states,
 *  - 14px cards / 10px controls, borders instead of heavy shadows, Manrope everywhere.
 * Dashboards use these tokens through the normal Tailwind classes (slate-*, blue-*, rounded-*, shadow-*),
 * so changing them here restyles all of them together without touching their content.
 * The client dashboard (.cd) has its own scoped stylesheet and is unaffected by the colour overrides.
 *
 * @type {import('tailwindcss').Config}
 */
const sans = ['Manrope', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'];

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // MetricCard builds `bg-<color>-50` from a prop at runtime.
  safelist: [{ pattern: /^bg-(slate|gray|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-50$/ }],
  theme: {
    extend: {
      fontFamily: {
        sans,
        heading: sans,
        serif: sans,
        mono: ['JetBrains Mono', 'monospace']
      },
      colors: {
        control: { light: '#F7F8FA', card: '#FFFFFF', cardHover: '#F1F2F4', border: '#E7E9EE' },
        // neutrals: page #F7F8FA, hairline borders #E7E9EE, muted text #6B7280, ink #111827
        slate: {
          50: '#F7F8FA',
          100: '#F1F2F4',
          200: '#E7E9EE',
          300: '#DDE0E6',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
          950: '#0B1220'
        },
        // accent: #2F5BEA, tinted active #EEF2FF with #2340B8 text, chart tint #C7D2FE
        blue: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#6F8BF0',
          500: '#4C6EF5',
          600: '#2F5BEA',
          700: '#2340B8',
          800: '#1A2F8A',
          900: '#16256B'
        },
        // indigo shares the accent scale so older screens that used it match the rest
        indigo: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#6F8BF0',
          500: '#4C6EF5',
          600: '#2F5BEA',
          700: '#2340B8',
          800: '#1A2F8A',
          900: '#16256B'
        },
        // semantic status colours (tint + ink), shared by every badge, banner and metric
        emerald: { 50: '#E7F6EE', 100: '#D3EEDF', 700: '#17663A', 800: '#124F2E' },
        green: { 50: '#E7F6EE', 100: '#D3EEDF', 700: '#17663A', 800: '#124F2E' },
        amber: { 50: '#FEF1E2', 100: '#FCE4C5', 700: '#9A4A06', 800: '#7A3A05' },
        orange: { 50: '#FEF1E2', 100: '#FCE4C5', 700: '#9A4A06', 800: '#7A3A05' },
        rose: { 50: '#FDECEC', 100: '#FAD9D9', 700: '#A61B1B', 800: '#841515' },
        red: { 50: '#FDECEC', 100: '#FAD9D9', 700: '#A61B1B', 800: '#841515' }
      },
      borderRadius: {
        lg: '8px',
        xl: '10px',
        '2xl': '14px',
        '3xl': '18px'
      },
      boxShadow: {
        sm: '0 1px 2px rgba(17, 24, 39, 0.04)',
        DEFAULT: '0 1px 3px rgba(17, 24, 39, 0.06)',
        md: '0 4px 12px rgba(17, 24, 39, 0.06)',
        lg: '0 8px 24px rgba(17, 24, 39, 0.08)',
        xl: '0 12px 32px rgba(17, 24, 39, 0.10)',
        '2xl': '0 20px 48px rgba(17, 24, 39, 0.14)'
      }
    }
  }
};
