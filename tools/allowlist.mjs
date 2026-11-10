// Single source of truth for what gets published. Anything not listed here is
// never deployed: .env, scripts/, raw/intermediate data, node_modules, tooling.
// If the app starts loading a new file at runtime, add it here (check-site
// fails the pipeline if a page references a file that is missing from _site).
export const PUBLISHED_FILES = [
  'index.html',
  'app.js',
  'transit.js',
  'groups.js',
  'geocode.js',
  'style.css',
  'fonts/atkinson-hyperlegible-next.woff2',
  'data/graph.json',
  'data/graph.bin',
];

// Marker file so GitHub Pages skips Jekyll processing.
export const EXTRA_FILES = ['.nojekyll'];
