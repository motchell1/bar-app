import { DefaultTheme } from '@react-navigation/native';

const colors = {
  background: '#0F172A',
  surface: '#111827',
  card: '#1F2937',
  text: '#F9FAFB',
  mutedText: '#9CA3AF',
  primary: '#F97316',
  border: '#374151',
  success: '#22C55E',
  danger: '#EF4444',
};

const navigation = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.card,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

export const theme = {
  colors,
  navigation,
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 18,
  },
};
