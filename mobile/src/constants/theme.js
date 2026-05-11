import { DefaultTheme } from '@react-navigation/native';

export const colors = {
  background: '#0C1020',
  surface: '#141A2E',
  border: '#242D47',
  text: '#F4F6FF',
  textMuted: '#A8B2D1',
  primary: '#FF8C42',
  tabInactive: '#7D88AB',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    border: colors.border,
    text: colors.text,
  },
};
