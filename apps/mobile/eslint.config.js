const expo = require('eslint-config-expo/flat');

module.exports = [
  {
    ignores: ['dist/**', '.expo/**', 'ios/**', 'android/**', 'scripts/**', 'tests/**'],
  },
  ...expo,
  {
    // React 19's compiler-oriented advisory rules are intentionally not build
    // gates yet. The app still uses stable ref-backed subscriptions and effect
    // reset patterns that are valid in React Native but rejected by those
    // experimental checks.
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
];
