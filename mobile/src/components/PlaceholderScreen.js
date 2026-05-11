import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from './ScreenContainer';
import { colors } from '../constants/colors';

export function PlaceholderScreen({ title, subtitle }) {
  return (
    <ScreenContainer>
      <View style={styles.wrapper}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10
  },
  title: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '700'
  },
  subtitle: {
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280
  }
});
