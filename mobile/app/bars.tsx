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

  const toolbar = (
    <View style={styles.toolbar}>
      <View style={styles.toolbarInner}>
        <Text style={styles.toolbarTitle} onPress={() => scrollRef.current?.scrollTo?.({ y: 0, animated: true })}>BAR APP</Text>
        <Text style={styles.hamburgerButton}>☰</Text>
      </View>
    </View>
  );

  return (
    <ScreenContainer scrollViewRef={scrollRef} stickyHeader={toolbar}>
      <View style={styles.searchWrap}>
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

      {!loading && !error ? <View style={styles.listWrap}>{filteredBars.map((bar) => (
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
          ))}</View> : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  toolbar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e6e6eb' },
  toolbarInner: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  toolbarTitle: { fontSize: 18, fontWeight: '800', color: '#111' },
  hamburgerButton: { fontSize: 20, color: '#444' },
  searchWrap: { backgroundColor: '#f5f5f5' },
  input: {
    backgroundColor: '#fff',
    color: '#333',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e1e1e6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 14,
  },
  rowWrap: { marginBottom: 8 },
  favoritesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  filterLabel: { color: '#666', fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#d8d8df', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#007aff', borderColor: '#007aff' },
  chipText: { color: '#555', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  statusText: { color: '#666', marginBottom: 10, fontStyle: 'italic' },
  errorText: { color: '#c62828', marginBottom: 10 },
  listWrap: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  thumb: { width: 58, height: 58, borderRadius: 10, backgroundColor: '#ececf1' },
  content: { flex: 1 },
  name: { color: '#222', fontSize: 15, fontWeight: '700' },
  neighborhood: { color: '#777', fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.8 },
  meta: { color: '#666', fontSize: 12, marginTop: 6 },
  chevron: { color: '#b0b0b7', fontSize: 24, paddingHorizontal: 4 },
});
