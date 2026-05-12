import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { SectionCard } from '../components/SectionCard';
import { theme } from '../constants/theme';

export default function BarsScreen() {
  return (
    <ScreenContainer>
      <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800' }}>Bars</Text>
      <SectionCard
        title="Browse Bars"
        subtitle="Placeholder list of bars. Later this tab can call services/api.ts and render results."
        ctaLabel="Load Bars"
        icon={<MaterialCommunityIcons name="glass-wine" color={theme.colors.accent} size={20} />}
      />
    </ScreenContainer>
  );
}
