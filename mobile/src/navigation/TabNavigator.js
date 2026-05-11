import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import HomeScreen from '../screens/HomeScreen';
import BarsScreen from '../screens/BarsScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import MapScreen from '../screens/MapScreen';
import { COLORS } from '../constants/theme';

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: COLORS.background,
    card: COLORS.surface,
    text: COLORS.textPrimary,
    border: COLORS.border,
  },
};

const screenOptions = ({ route }) => ({
  headerShown: false,
  tabBarActiveTintColor: COLORS.accent,
  tabBarInactiveTintColor: COLORS.textSecondary,
  tabBarStyle: {
    backgroundColor: COLORS.surface,
    borderTopColor: COLORS.border,
    height: 62,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabBarIcon: ({ color, size }) => {
    const iconNameByRoute = {
      Home: 'home-filled',
      Bars: 'local-bar',
      Favorites: 'favorite',
      Map: 'map',
    };

    return <MaterialIcons name={iconNameByRoute[route.name]} size={size} color={color} />;
  },
});

export default function TabNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator initialRouteName='Home' screenOptions={screenOptions}>
        <Tab.Screen name='Home' component={HomeScreen} />
        <Tab.Screen name='Bars' component={BarsScreen} />
        <Tab.Screen name='Favorites' component={FavoritesScreen} />
        <Tab.Screen name='Map' component={MapScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
