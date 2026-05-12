import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, StyleSheet, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { SectionCard } from '../components/SectionCard';
import { theme } from '../constants/theme';

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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: 8 },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: theme.colors.subtleText, fontSize: 15, lineHeight: 21 },
});
