import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../constants/theme';

export function PlaceholderState({ title, description }) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  description: {
    color: theme.colors.mutedText,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
  },
});
