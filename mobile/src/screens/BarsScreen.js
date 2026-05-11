import ScreenContainer from '../components/ScreenContainer';
import SectionHeader from '../components/SectionHeader';
import PlaceholderCard from '../components/PlaceholderCard';

export default function BarsScreen() {
  return (
    <ScreenContainer>
      <SectionHeader
        title='Bars'
        subtitle='Browse bars by neighborhood, open status, and special type.'
      />
      <PlaceholderCard
        label='Search and filters'
        description='List filtering controls for neighborhoods, tags, and open-now state.'
      />
      <PlaceholderCard
        label='Bar list'
        description='Scrollable list of bars with quick access to details and favorites.'
      />
    </ScreenContainer>
  );
}
