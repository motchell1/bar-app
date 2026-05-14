import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { SectionCard } from '../components/SectionCard';
import { theme } from '../constants/theme';
import { GOOGLE_MAPS_MOBILE_API_KEY } from '../services/config';

export default function MapScreen() {
  return (
    <ScreenContainer>
      <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800' }}>Map</Text>
      <SectionCard
        title="Nearby Map"
        subtitle={GOOGLE_MAPS_MOBILE_API_KEY
          ? 'Mobile Maps API key detected from environment. Map UI wiring can use this key when the map library is enabled.'
          : 'Set EXPO_PUBLIC_GOOGLE_MAPS_MOBILE_API_KEY in environment to enable mobile map provider setup.'}
        ctaLabel="Enable Location"
        icon={<MaterialCommunityIcons name="map-marker-radius" color={theme.colors.accent} size={20} />}
      />
    </ScreenContainer>
  );
}
