import { DefaultTheme } from '@react-navigation/native';

export const colors = {
  background: '#0B0F1A',
  surface: '#151B2A',
  surfaceMuted: '#1E2639',
  textPrimary: '#F5F7FF',
  textSecondary: '#A7B0C8',
  accent: '#FF8A3D',
  border: '#2A3248',
  tabInactive: '#7D88A6',
  success: '#4FD88A',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const theme = {
  navigation: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.border,
      primary: colors.accent,
    },
  },
};
