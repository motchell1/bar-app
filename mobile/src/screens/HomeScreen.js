import { PlaceholderState } from '../components/PlaceholderState';
import { ScreenContainer } from '../components/ScreenContainer';

export function HomeScreen() {
  return (
    <ScreenContainer>
      <PlaceholderState
        title="Tonight's Specials"
        description="Home feed placeholder. Show highlighted happy hours and featured drink deals here."
      />
    </ScreenContainer>
  );
}
