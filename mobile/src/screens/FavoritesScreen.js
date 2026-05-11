import { PlaceholderState } from '../components/PlaceholderState';
import { ScreenContainer } from '../components/ScreenContainer';

export function FavoritesScreen() {
  return (
    <ScreenContainer>
      <PlaceholderState
        title="Saved Specials"
        description="Favorites placeholder. Show liked bars and bookmarked specials for quick access."
      />
    </ScreenContainer>
  );
}
