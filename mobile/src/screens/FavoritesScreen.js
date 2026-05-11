import ScreenContainer from '../components/ScreenContainer';
import SectionHeader from '../components/SectionHeader';
import PlaceholderCard from '../components/PlaceholderCard';

export default function FavoritesScreen() {
  return (
    <ScreenContainer>
      <SectionHeader
        title='Favorites'
        subtitle='Your saved bars and specials in one place.'
      />
      <PlaceholderCard
        label='Saved bars'
        description='Persisted favorites synced to API or local storage for quick recall.'
      />
      <PlaceholderCard
        label='Notifications (future)'
        description='Optional reminders when your favorite spots begin happy hour.'
      />
    </ScreenContainer>
  );
}
