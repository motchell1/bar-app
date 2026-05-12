import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { SectionCard } from '../components/SectionCard';
import { theme } from '../constants/theme';

export default function FavoritesScreen() {
  return (
    <ScreenContainer>
      <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800' }}>Favorites</Text>
      <SectionCard
        title="Saved Specials"
        subtitle="Placeholder area for the bars and deals users mark as favorites."
        ctaLabel="Sign In Later"
        icon={<MaterialCommunityIcons name="heart" color={theme.colors.accent} size={20} />}
      />
    </ScreenContainer>
  );
}
