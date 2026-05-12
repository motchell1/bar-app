import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { SectionCard } from '../components/SectionCard';
import { theme } from '../constants/theme';

export default function MapScreen() {
  return (
    <ScreenContainer>
      <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800' }}>Map</Text>
      <SectionCard
        title="Nearby Map"
        subtitle="Placeholder map experience. A web-safe map can be added with a compatible Expo library later."
        ctaLabel="Enable Location"
        icon={<MaterialCommunityIcons name="map-marker-radius" color={theme.colors.accent} size={20} />}
      />
    </ScreenContainer>
  );
}
