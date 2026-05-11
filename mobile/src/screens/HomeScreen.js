import { PlaceholderCard } from '../components/common/PlaceholderCard';
import { Screen } from '../components/layout/Screen';

export function HomeScreen() {
  return (
    <Screen>
      <PlaceholderCard
        title="Tonight's Specials"
        description="This feed will highlight nearby specials, featured venues, and time-sensitive happy hour updates."
      />
    </Screen>
  );
}
