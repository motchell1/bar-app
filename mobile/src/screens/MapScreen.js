import ScreenContainer from '../components/ScreenContainer';
import SectionHeader from '../components/SectionHeader';
import PlaceholderCard from '../components/PlaceholderCard';

export default function MapScreen() {
  return (
    <ScreenContainer>
      <SectionHeader
        title='Map'
        subtitle='Discover nearby bars and specials geographically.'
      />
      <PlaceholderCard
        label='Map viewport'
        description='Map markers for bars and cluster handling in dense areas.'
      />
      <PlaceholderCard
        label='Location actions'
        description='Current-location button and route launch to selected bar details.'
      />
    </ScreenContainer>
  );
}
