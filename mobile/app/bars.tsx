import { useMemo, useRef, useState, useEffect } from 'react';
import { useScrollToTop } from '@react-navigation/native';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { fetchStartupPayload, StartupPayload } from '../services/api';

function toSortedBars(payload: StartupPayload | null) {
  const bars = Object.values(payload?.bars || {});
  return bars.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export default function BarsScreen() {
  const scrollRef = useRef<any>(null);
  useScrollToTop(scrollRef);

  const [payload, setPayload] = useState<StartupPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

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
  const filteredBars = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return bars.filter((bar) => (!normalizedQuery ? true : (bar.name || '').toLowerCase().includes(normalizedQuery)));
  }, [bars, query]);

  const toolbar = (
    <View style={styles.toolbar}>
      <View style={styles.toolbarInner}>
        <Text style={styles.toolbarTitle} onPress={() => scrollRef.current?.scrollTo?.({ top: 0, animated: true })}>BAR APP</Text>
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
      </View>

      {loading ? <Text style={styles.statusText}>Loading bars…</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!loading && !error && filteredBars.length === 0 ? <Text style={styles.statusText}>No bars found.</Text> : null}

      {!loading && !error ? (
        <View style={styles.listWrap}>
          {filteredBars.map((bar) => (
            <View key={`${bar.bar_id}-${bar.name}`} style={styles.card}>
              <Image
                source={{ uri: bar.image_url && bar.image_url !== 'null' ? bar.image_url : 'https://placehold.co/144x144?text=Bar' }}
                style={styles.thumb}
              />
              <View style={styles.content}>
                <Text style={styles.name}>{bar.name}</Text>
                <Text style={styles.neighborhood}>{bar.neighborhood}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  toolbar: { backgroundColor: '#007bff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  toolbarInner: { height: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  toolbarTitle: { color: '#fff', fontSize: 16, fontWeight: '700', textTransform: 'uppercase' },
  hamburgerButton: { position: 'absolute', right: 16, top: 10, color: '#fff', fontSize: 24, lineHeight: 28 },
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
  chevron: { color: '#b0b0b7', fontSize: 24, paddingHorizontal: 4 },
});
