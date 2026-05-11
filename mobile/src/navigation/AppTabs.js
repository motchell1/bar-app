import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { colors } from '../constants/theme';
import { BarsScreen } from '../screens/BarsScreen';
import { FavoritesScreen } from '../screens/FavoritesScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { MapScreen } from '../screens/MapScreen';

const Tab = createBottomTabNavigator();

const routeIcon = {
  Home: 'home-outline',
  Bars: 'wine-outline',
  Favorites: 'heart-outline',
  Map: 'map-outline',
};

export function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        tabBarIcon: ({ color, size, focused }) => {
          const base = routeIcon[route.name] || 'ellipse-outline';
          const iconName = focused ? base.replace('-outline', '') : base;
          return <Ionicons color={color} name={iconName} size={size} />;
        },
      })}
    >
      <Tab.Screen component={HomeScreen} name="Home" />
      <Tab.Screen component={BarsScreen} name="Bars" />
      <Tab.Screen component={FavoritesScreen} name="Favorites" />
      <Tab.Screen component={MapScreen} name="Map" />
    </Tab.Navigator>
  );
}
