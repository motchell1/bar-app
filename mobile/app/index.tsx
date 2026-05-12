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

function format12Hour(timeValue?: string | null) {
  if (!timeValue) return null;
  const [hourRaw, minuteRaw] = timeValue.split(':');
  const hour = Number.parseInt(hourRaw, 10);
  const minute = Number.parseInt(minuteRaw, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${normalizedHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function buildTimeBadgeLabel(special: NonNullable<StartupPayload['specials']>[string]) {
  if (special.all_day) return 'ALL\nDAY';
  const start = format12Hour(special.start_time);
  const end = format12Hour(special.end_time);
  if (start && end) return `${start}\n- ${end}`;
  return 'SOON';
}

export default function SpecialsScreen() {
  const [payload, setPayload] = useState<StartupPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
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

              const specials = (entry.specials ?? [])
                .map((specialId) => payload?.specials?.[String(specialId)])
                .filter((special): special is NonNullable<typeof special> => Boolean(special && special.description));

              if (specials.length === 0) return null;

              const hourMeta = payload?.open_hours?.[String(entry.bar_id)]?.[dayKey];
              const isToday = dayKey === payload?.general_data?.current_day;
              const isOpen = bar.currently_open ?? bar.is_open_now;

              return (
                <View key={`${dayKey}-${entry.bar_id}`} style={styles.card}>
                  {bar.image_url ? <Image source={{ uri: bar.image_url }} style={styles.cardImage} /> : null}
                  <View style={styles.cardContent}>
                    <View style={styles.headingRow}>
                      <Text style={styles.barName}>{bar.name}</Text>
                      <Text style={styles.neighborhood}>{bar.neighborhood}</Text>
                    </View>

                    <View style={styles.specialsList}>
                      {specials.map((special, index) => {
                        const status = (special.current_status ?? '').toLowerCase();
                        return (
                          <View key={`${dayKey}-${entry.bar_id}-${index}`} style={styles.specialItem}>
                            <Text style={[styles.timeBadge, status === 'past' ? styles.timeBadgePast : null]}>{buildTimeBadgeLabel(special)}</Text>
                            <Text style={styles.specialDescription}>{special.description}</Text>
                          </View>
                        );
                      })}
                    </View>

                    <Text style={styles.hours}>
                      {hourMeta?.display_text
                        ? isToday
                          ? isOpen
                            ? `Open • Closes ${format12Hour(hourMeta.close_time) ?? ''}`.trim()
                            : `Closed • Opens ${format12Hour(hourMeta.open_time) ?? ''}`.trim()
                          : `Hours: ${hourMeta.display_text}`
                        : 'Hours unavailable'}
                    </Text>
                  </View>
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
  daySection: { gap: 12 },
  dayHeader: { color: '#636366', fontSize: 16, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: '#d1d5db', paddingBottom: 8 },
  noSpecials: { color: '#555', fontStyle: 'italic', textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  cardImage: { width: '100%', height: 180 },
  cardContent: { padding: 16 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  barName: { color: '#111827', fontSize: 21, fontWeight: '700', flexShrink: 1 },
  neighborhood: { color: '#777', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, maxWidth: '45%', textAlign: 'right' },
  specialsList: { gap: 8, marginTop: 12 },
  specialItem: { backgroundColor: '#f7f9fc', borderWidth: 1, borderColor: '#e6ecf5', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeBadge: { width: 74, minWidth: 74, backgroundColor: '#007bff', color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center', borderRadius: 6, overflow: 'hidden', paddingVertical: 4 },
  timeBadgePast: { backgroundColor: '#ccc', color: '#666' },
  specialDescription: { flex: 1, color: '#111827', fontSize: 13, lineHeight: 18 },
  hours: { color: '#333', fontSize: 13, marginTop: 10 },
  errorText: { color: '#fca5a5', fontSize: 14 },
});
