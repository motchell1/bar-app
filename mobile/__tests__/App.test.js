import { render } from '@testing-library/react-native';
import HomeScreen from '../src/screens/HomeScreen';
import BarsScreen from '../src/screens/BarsScreen';
import FavoritesScreen from '../src/screens/FavoritesScreen';
import MapScreen from '../src/screens/MapScreen';

describe('Mobile app structure', () => {
  it('renders home placeholder screen content', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText("Tonight's Specials")).toBeTruthy();
  });

  it('renders all placeholder tabs', () => {
    expect(render(<BarsScreen />).getByText('Bars')).toBeTruthy();
    expect(render(<FavoritesScreen />).getByText('Favorites')).toBeTruthy();
    expect(render(<MapScreen />).getByText('Map')).toBeTruthy();
  });
});
