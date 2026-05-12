import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { BarsScreen } from '../screens/BarsScreen';
import { FavoritesScreen } from '../screens/FavoritesScreen';
import { MapScreen } from '../screens/MapScreen';
import { colors } from '../constants/colors';

const Tab = createBottomTabNavigator();

export const TAB_CONFIG = {
  Home: {
    component: HomeScreen,
    icon: 'cash'
  },
  Bars: {
    component: BarsScreen,
    icon: 'beer'
  },
  Favorites: {
    component: FavoritesScreen,
    icon: 'star-outline'
  },
  Map: {
    component: MapScreen,
    icon: 'map-marker-outline'
  }
};

export function RootTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64,
          paddingTop: 6,
          paddingBottom: 10
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600'
        },
        tabBarIcon: ({ color, size }) => (
          <MaterialCommunityIcons
            name={TAB_CONFIG[route.name].icon}
            color={color}
            size={size}
          />
        )
      })}
    >
      {Object.entries(TAB_CONFIG).map(([name, config]) => (
        <Tab.Screen key={name} name={name} component={config.component} />
      ))}
    </Tab.Navigator>
  );
}
