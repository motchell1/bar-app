import { PlaceholderState } from '../components/PlaceholderState';
import { ScreenContainer } from '../components/ScreenContainer';

export function BarsScreen() {
  return (
    <ScreenContainer>
      <PlaceholderState
        title="Bars Near You"
        description="Bars list placeholder. Add search, filters, and distance sorting in this screen."
      />
    </ScreenContainer>
  );
}
