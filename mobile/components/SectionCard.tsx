import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../constants/theme';

type SectionCardProps = {
  title: string;
  subtitle: string;
  ctaLabel: string;
  icon?: ReactNode;
};

export function SectionCard({ title, subtitle, ctaLabel, icon }: SectionCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        {icon}
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <Pressable style={styles.button}>
        <Text style={styles.buttonText}>{ctaLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: theme.colors.text,
    fontSize: 19,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.colors.subtleText,
    fontSize: 15,
    lineHeight: 21,
  },
  button: {
    backgroundColor: theme.colors.accent,
    minHeight: 46,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  buttonText: {
    color: '#0B1220',
    fontWeight: '700',
    fontSize: 15,
  },
});
