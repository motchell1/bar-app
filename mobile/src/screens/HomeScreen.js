import PlaceholderSection from '../components/PlaceholderSection';
import ScreenContainer from '../components/ScreenContainer';

export default function HomeScreen() {
  return (
    <ScreenContainer>
      <PlaceholderSection
        title="Tonight's Specials"
        subtitle="Home feed goes here: featured bars, happy hour countdowns, and nearby deals."
      />
    </ScreenContainer>
  );
}
