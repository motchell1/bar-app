import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { theme } from '../constants/theme';
import { fetchStartupPayload, StartupPayload } from '../services/api';

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function orderedDayKeys(currentDay?: string) {
  const configuredStartIndex = DAYS_FULL.findIndex((day) => day.slice(0, 3).toUpperCase() === currentDay);
  const startIndex = configuredStartIndex >= 0 ? configuredStartIndex : new Date().getDay();
  return Array.from({ length: 7 }, (_, offset) => {
    const dayName = DAYS_FULL[(startIndex + offset + 7) % 7];
    return {
      dayKey: dayName.slice(0, 3).toUpperCase(),
      dayLabel: offset === 0 ? `${dayName} (Today)` : dayName,
    };
  });
}

export default function SpecialsScreen() {
  const [payload, setPayload] = useState<StartupPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await fetchStartupPayload();
        setPayload(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load specials.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const weekDays = useMemo(() => orderedDayKeys(payload?.general_data?.current_day), [payload?.general_data?.current_day]);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>Tonight&apos;s Specials</Text>
        <Text style={styles.subtitle}>Discover happy hours and late-night deals near you.</Text>
      </View>

      {loading ? <ActivityIndicator color={theme.colors.accent} size="large" /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {!loading && !error && weekDays.map(({ dayKey, dayLabel }) => {
        const entries = payload?.specials_by_day?.[dayKey] ?? [];
        return (
          <View key={dayKey} style={styles.daySection}>
            <Text style={styles.dayHeader}>{dayLabel}</Text>
            {entries.length === 0 ? <Text style={styles.noSpecials}>No specials available.</Text> : null}

            {entries.map((entry) => {
              const bar = payload?.bars?.[String(entry.bar_id)];
              if (!bar) return null;

              const specialDescriptions = (entry.specials ?? [])
                .map((specialId) => payload?.specials?.[String(specialId)])
                .filter((special): special is NonNullable<typeof special> => Boolean(special && special.description));

              if (specialDescriptions.length === 0) return null;

              const hoursText = payload?.open_hours?.[String(entry.bar_id)]?.[dayKey]?.display_text ?? 'Hours unavailable';

              return (
                <View key={`${dayKey}-${entry.bar_id}`} style={styles.card}>
                  {bar.image_url ? <Image source={{ uri: bar.image_url }} style={styles.cardImage} /> : null}
                  <Text style={styles.barName}>{bar.name}</Text>
                  <Text style={styles.neighborhood}>{bar.neighborhood}</Text>

                  {specialDescriptions.map((special, index) => (
                    <Text key={`${dayKey}-${entry.bar_id}-${index}`} style={styles.specialText}>
                      • {special.description}
                    </Text>
                  ))}

                  <Text style={styles.hours}>Hours: {hoursText}</Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: 8 },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: theme.colors.subtleText, fontSize: 15, lineHeight: 21 },
  daySection: { gap: 10 },
  dayHeader: { color: theme.colors.text, fontSize: 20, fontWeight: '700', marginTop: 6 },
  noSpecials: { color: theme.colors.subtleText, fontStyle: 'italic' },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 6,
  },
  cardImage: { width: '100%', height: 150, borderRadius: 10, marginBottom: 4 },
  barName: { color: theme.colors.text, fontSize: 19, fontWeight: '700' },
  neighborhood: { color: theme.colors.subtleText, fontSize: 14, marginBottom: 4 },
  specialText: { color: theme.colors.text, fontSize: 15, lineHeight: 20 },
  hours: { color: theme.colors.subtleText, fontSize: 13, marginTop: 4 },
  errorText: { color: '#fca5a5', fontSize: 14 },
});
