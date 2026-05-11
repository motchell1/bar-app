import { PlaceholderCard } from '../components/common/PlaceholderCard';
import { Screen } from '../components/layout/Screen';

export function FavoritesScreen() {
  return (
    <Screen>
      <PlaceholderCard
        title="Favorites"
        description="Saved bars and specials will appear here for quick revisit and notifications."
      />
    </Screen>
  );
}
