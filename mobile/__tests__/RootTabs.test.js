import { TAB_CONFIG } from '../src/navigation/RootTabs';

describe('RootTabs config', () => {
  it('maps each tab to the current web-inspired icon contract', () => {
    expect(TAB_CONFIG.Home.icon).toBe('cash');
    expect(TAB_CONFIG.Bars.icon).toBe('beer');
    expect(TAB_CONFIG.Favorites.icon).toBe('star-outline');
    expect(TAB_CONFIG.Map.icon).toBe('map-marker-outline');
  });
});
