/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./web/**/*.{html,js}'],
  // jobs.js builds command-badge classes as `bg-${color}-100` / `text-${color}-700`
  // template strings, which Tailwind's static scanner can't see as literal
  // class names — list them explicitly so they aren't purged.
  safelist: [
    'bg-slate-100', 'text-slate-600',
    'bg-amber-100', 'text-amber-700',
    'bg-orange-100', 'text-orange-700',
    'bg-rose-100', 'text-rose-700',
    'bg-sky-100', 'text-sky-700',
    'bg-violet-100', 'text-violet-700',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef6ff',
          100: '#d9ecff',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
