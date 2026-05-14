import { useMemo, useRef, useState, useEffect } from 'react';
import { useScrollToTop } from '@react-navigation/native';
import { Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { fetchStartupPayload, StartupPayload } from '../services/api';
import { theme } from '../constants/theme';

type BarItem = NonNullable<StartupPayload['bars']>[string] & { favorite?: boolean };

function toSortedBars(payload: StartupPayload | null) {
  const bars = Object.values(payload?.bars || {});
  return bars
    .map((bar) => ({ ...bar, favorite: Boolean(bar.favorite) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export default function BarsScreen() {
  const scrollRef = useRef<any>(null);
  useScrollToTop(scrollRef);

  const [payload, setPayload] = useState<StartupPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string>('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setPayload(await fetchStartupPayload());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load bars.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const bars = useMemo(() => toSortedBars(payload), [payload]);

  const neighborhoods = useMemo(
    () => Array.from(new Set(bars.map((bar) => bar.neighborhood).filter(Boolean))).sort(),
    [bars]
  );

  const filteredBars = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return bars.filter((bar) => {
      const matchesNeighborhood = !selectedNeighborhood || bar.neighborhood === selectedNeighborhood;
      if (!matchesNeighborhood) return false;
      if (favoritesOnly && !bar.favorite) return false;
      if (!normalizedQuery) return true;
      return (bar.name || '').toLowerCase().includes(normalizedQuery);
    });
  }, [bars, query, selectedNeighborhood, favoritesOnly]);

  return (
    <ScreenContainer scrollViewRef={scrollRef}>
      <Text style={styles.title}>Bars</Text>

      <View style={styles.filtersCard}>
        <TextInput
          placeholder="Search bars"
          placeholderTextColor="#9aa0aa"
          value={query}
          onChangeText={setQuery}
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="none"
        />

        <View style={styles.rowWrap}>
          <Text style={styles.filterLabel}>Neighborhood</Text>
          <View style={styles.chipsWrap}>
            <Pressable
              style={[styles.chip, !selectedNeighborhood ? styles.chipActive : null]}
              onPress={() => setSelectedNeighborhood('')}
            >
              <Text style={[styles.chipText, !selectedNeighborhood ? styles.chipTextActive : null]}>All</Text>
            </Pressable>
            {neighborhoods.map((name) => (
              <Pressable
                key={name}
                style={[styles.chip, selectedNeighborhood === name ? styles.chipActive : null]}
                onPress={() => setSelectedNeighborhood(name)}
              >
                <Text style={[styles.chipText, selectedNeighborhood === name ? styles.chipTextActive : null]}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.favoritesRow}>
          <Text style={styles.filterLabel}>Favorites only</Text>
          <Switch value={favoritesOnly} onValueChange={setFavoritesOnly} trackColor={{ true: theme.colors.accent }} />
        </View>
      </View>

      {loading ? <Text style={styles.statusText}>Loading bars…</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {!loading && !error && filteredBars.length === 0 ? (
        <Text style={styles.statusText}>No bars match your current filters.</Text>
      ) : null}

      {!loading && !error
        ? filteredBars.map((bar) => (
            <View key={`${bar.bar_id}-${bar.name}`} style={styles.card}>
              <Image
                source={{ uri: bar.image_url && bar.image_url !== 'null' ? bar.image_url : 'https://placehold.co/144x144?text=Bar' }}
                style={styles.thumb}
              />
              <View style={styles.content}>
                <Text style={styles.name}>{bar.name}</Text>
                <Text style={styles.neighborhood}>{bar.neighborhood}</Text>
                <Text style={styles.meta}>{bar.is_open_now ? 'Open now' : 'Closed now'}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          ))
        : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { color: theme.colors.text, fontSize: 28, fontWeight: '800', marginBottom: 14 },
  filtersCard: { backgroundColor: '#1a1d25', borderRadius: 16, borderWidth: 1, borderColor: '#2c313d', padding: 12, marginBottom: 14 },
  input: { backgroundColor: '#10141d', color: theme.colors.text, borderRadius: 10, borderWidth: 1, borderColor: '#31384a', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  rowWrap: { marginBottom: 10 },
  favoritesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  filterLabel: { color: '#cfd5e2', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#444d62', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  chipText: { color: '#c7ceda', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#111723' },
  statusText: { color: '#c0c7d3', marginBottom: 10 },
  errorText: { color: '#f77979', marginBottom: 10 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1d25', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#2b3040', marginBottom: 10 },
  thumb: { width: 76, height: 76, backgroundColor: '#2d3342' },
  content: { flex: 1, paddingHorizontal: 12, paddingVertical: 8 },
  name: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  neighborhood: { color: '#a6afbf', fontSize: 12, marginTop: 2 },
  meta: { color: '#d2d8e4', fontSize: 12, marginTop: 8 },
  chevron: { color: '#7d8797', fontSize: 24, paddingHorizontal: 10 },
});
