import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppTabs } from './src/navigation/AppTabs';
import { theme } from './src/constants/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme.navigation}>
        <StatusBar style="light" />
        <AppTabs />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
