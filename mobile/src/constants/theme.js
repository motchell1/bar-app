import { DefaultTheme } from '@react-navigation/native';
import { colors } from './colors';

export const theme = {
  navigationTheme: {
    ...DefaultTheme,
    dark: false,
    colors: {
      ...DefaultTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.border,
      notification: colors.success
    }
  }
};
