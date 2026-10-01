/**
 * Tailwind CSS v4 runs as a PostCSS plugin — there is no tailwind.config.js and no `content`
 * array to maintain; v4 scans the project itself and design tokens are declared with `@theme`
 * in app/globals.css.
 *
 * Turbopack resolves the project-root PostCSS config first, so this one file covers every
 * stylesheet (next.config.ts `experimental.turbopackLocalPostcssConfig` would reverse that,
 * and we do not need it).
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
