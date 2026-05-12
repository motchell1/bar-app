import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BadgeDollarSign, Beer, MapPin, Star } from 'lucide-react-native';
import HomeScreen from '../screens/HomeScreen';
import BarsScreen from '../screens/BarsScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import MapScreen from '../screens/MapScreen';
import { theme } from '../constants/theme';

const Tab = createBottomTabNavigator();

const iconByRoute = {
  Home: BadgeDollarSign,
  Bars: Beer,
  Favorites: Star,
  Map: MapPin,
};

export default function RootTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.mutedText,
        tabBarIcon: ({ color, size }) => {
          const Icon = iconByRoute[route.name];
          return <Icon color={color} size={size} strokeWidth={2} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Bars" component={BarsScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen name="Map" component={MapScreen} />
    </Tab.Navigator>
  );
}
