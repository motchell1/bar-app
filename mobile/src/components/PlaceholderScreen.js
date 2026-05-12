import { StyleSheet, Text, View } from 'react-native';
import ScreenContainer from './ScreenContainer';
import { theme } from '../constants/theme';

export default function PlaceholderScreen({ title, description }) {
  return (
    <ScreenContainer>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  title: {
    ...theme.typography.title,
    color: theme.colors.text,
  },
  description: {
    ...theme.typography.body,
    color: theme.colors.mutedText,
    lineHeight: 22,
  },
});
