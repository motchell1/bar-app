import { PlaceholderState } from '../components/PlaceholderState';
import { ScreenContainer } from '../components/ScreenContainer';

export function MapScreen() {
  return (
    <ScreenContainer>
      <PlaceholderState
        title="Specials Map"
        description="Map placeholder. Integrate geolocation and pin nearby bars with active deals."
      />
    </ScreenContainer>
  );
}
