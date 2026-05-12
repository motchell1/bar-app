import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, StyleSheet, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { SectionCard } from '../components/SectionCard';
import { theme } from '../constants/theme';

const iconGroups: Array<{ label: string; icons: string[] }> = [
  { label: 'Cocktails', icons: ['glass-cocktail', 'glass-wine', 'bottle-wine', 'shaker-outline'] },
  { label: 'Bar', icons: ['barley', 'countertop-outline', 'storefront-outline', 'glass-mug-variant'] },
  {
    label: 'Restaurant',
    icons: ['silverware-fork-knife', 'food', 'chef-hat', 'table-furniture'],
  },
  { label: 'Beer', icons: ['beer', 'beer-outline', 'beer-alert-outline', 'glass-mug'] },
  {
    label: 'Specials',
    icons: ['tag', 'tag-heart-outline', 'ticket-percent-outline', 'star-circle-outline'],
  },
  {
    label: 'Money',
    icons: ['cash', 'currency-usd', 'wallet-outline', 'cash-multiple'],
  },
];

export default function HomeScreen() {
  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>Tonight&apos;s Specials</Text>
        <Text style={styles.subtitle}>Discover happy hours and late-night deals near you.</Text>
      </View>

      <SectionCard
        title="Featured Spot"
        subtitle="A placeholder card for your top bar and its best specials."
        ctaLabel="View Details"
        icon={<MaterialCommunityIcons name="star-circle" color={theme.colors.accent} size={20} />}
      />

      <View style={styles.iconPreviewCard}>
        <Text style={styles.iconPreviewTitle}>Tab Icon Options Preview</Text>
        <Text style={styles.iconPreviewSubtitle}>
          Pick one icon from each category and I&apos;ll wire them into the tabs.
        </Text>

        {iconGroups.map((group) => (
          <View key={group.label} style={styles.iconGroup}>
            <Text style={styles.iconGroupLabel}>{group.label}</Text>
            <View style={styles.iconRow}>
              {group.icons.map((iconName) => (
                <View key={iconName} style={styles.iconOption}>
                  <MaterialCommunityIcons name={iconName as any} size={24} color={theme.colors.text} />
                  <Text style={styles.iconName}>{iconName}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: 8 },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: theme.colors.subtleText, fontSize: 15, lineHeight: 21 },
  iconPreviewCard: {
    marginTop: 4,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    gap: 16,
  },
  iconPreviewTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  iconPreviewSubtitle: {
    color: theme.colors.subtleText,
    fontSize: 13,
    lineHeight: 18,
  },
  iconGroup: {
    gap: 8,
  },
  iconGroupLabel: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  iconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  iconOption: {
    width: '48%',
    minWidth: 130,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#121722',
  },
  iconName: {
    color: theme.colors.subtleText,
    fontSize: 12,
    flexShrink: 1,
  },
});
