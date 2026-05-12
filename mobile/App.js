import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { RootTabs } from './src/navigation/RootTabs';
import { theme } from './src/constants/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme.navigationTheme}>
        <StatusBar style="dark" />
        <RootTabs />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
