import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['_site/', 'node_modules/', 'data/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2023 },
    rules: {
      eqeqeq: 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Page scripts: plain <script> tags, not ES modules, browser globals only.
    files: ['*.js'],
    ignores: ['eslint.config.js', 'stylelint.config.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        L: 'readonly', // Leaflet, loaded from the CDN
        Transit: 'readonly', // set by transit.js
        Groups: 'readonly', // set by groups.js
        Ranking: 'readonly', // set by ranking.js
      },
    },
  },
  {
    // Node config, tooling, tests, and the API (Vercel functions) are ES modules.
    files: [
      'eslint.config.js',
      'stylelint.config.js',
      'tools/**/*.mjs',
      'tests/**/*.mjs',
      'api/**/*.js',
      'server/**/*.js',
    ],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
];
