import ScreenContainer from '../components/ScreenContainer';
import SectionHeader from '../components/SectionHeader';
import PlaceholderCard from '../components/PlaceholderCard';

export default function HomeScreen() {
  return (
    <ScreenContainer>
      <SectionHeader
        title="Tonight's Specials"
        subtitle='A quick view of featured bars and happy hour highlights.'
      />
      <PlaceholderCard
        label='Featured neighborhood'
        description='Show top specials for a selected neighborhood and time window.'
      />
      <PlaceholderCard
        label='Trending deals'
        description='Display currently popular specials with save and map shortcuts.'
      />
    </ScreenContainer>
  );
}
