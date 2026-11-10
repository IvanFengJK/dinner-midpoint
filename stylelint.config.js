export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // Keep classic max-width queries: range syntax (width <= 760px) needs 2022+ browsers.
    'media-feature-range-notation': 'prefix',
  },
};
