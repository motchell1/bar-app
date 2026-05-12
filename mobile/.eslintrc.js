module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    'prettier/prettier': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/no-unstable-nested-components': 'off',
  },
  overrides: [
    {
      files: ['**/__tests__/**/*.js'],
      env: {
        jest: true,
      },
    },
  ],
};
