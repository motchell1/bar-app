import { useMemo, useRef, useState, useEffect } from 'react';
import { useScrollToTop } from '@react-navigation/native';
import { Animated, Easing, Modal, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string>('');
  const [draftFavoritesOnly, setDraftFavoritesOnly] = useState(false);
  const [draftSelectedNeighborhood, setDraftSelectedNeighborhood] = useState<string>('');
  const drawerProgress = useRef(new Animated.Value(0)).current;

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
    () => Array.from(new Set(bars.map((bar) => bar.neighborhood).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [bars]
  );

  const filteredBars = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return bars.filter((bar) => {
      const queryMatch = !normalizedQuery ? true : (bar.name || '').toLowerCase().includes(normalizedQuery);
      const favoriteMatch = !favoritesOnly || bar.favorite === true;
      const neighborhoodMatch = !selectedNeighborhood || bar.neighborhood === selectedNeighborhood;
      return queryMatch && favoriteMatch && neighborhoodMatch;
    });
  }, [bars, query, favoritesOnly, selectedNeighborhood]);

  const openMenu = () => {
    drawerProgress.stopAnimation();
    setDraftFavoritesOnly(favoritesOnly);
    setDraftSelectedNeighborhood(selectedNeighborhood);
    setIsMenuOpen(true);
    Animated.timing(drawerProgress, {
      toValue: 1,
      duration: 230,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const closeMenu = () => {
    drawerProgress.stopAnimation();
    Animated.timing(drawerProgress, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setIsMenuOpen(false);
    });
  };

  const toolbar = (
    <View style={styles.toolbar}>
      <View style={styles.toolbarInner}>
        <Text style={styles.toolbarTitle} onPress={() => scrollRef.current?.scrollTo?.({ top: 0, animated: true })}>BAR APP</Text>
        <Text
          style={styles.hamburgerButton}
          onPress={openMenu}
        >
          ☰
        </Text>
      </View>
    </View>
  );

  return (
    <>
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

      <Modal visible={isMenuOpen} animationType="none" transparent onRequestClose={closeMenu}>
        <Animated.View style={[styles.overlay, { opacity: drawerProgress }]}>
          <Pressable style={styles.overlayTapArea} onPress={closeMenu} />
          <Animated.View
            style={[
              styles.sideMenu,
              {
                transform: [
                  {
                    translateX: drawerProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [300, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.sideHeader}>Filters</Text>

            <Text style={styles.sectionTitle}>Favorites</Text>
            <Pressable style={[styles.filterRow, draftFavoritesOnly ? styles.filterRowSelected : null]} onPress={() => setDraftFavoritesOnly((current) => !current)}>
              <View style={styles.filterLabelGroup}>
                <Text style={styles.iconText}>★</Text>
                <Text style={styles.filterText}>Favorites only</Text>
              </View>
              <Text style={styles.checkbox}>{draftFavoritesOnly ? '☑' : '☐'}</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>Neighborhood</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={draftSelectedNeighborhood} onValueChange={(nextValue) => setDraftSelectedNeighborhood(String(nextValue))}>
                <Picker.Item label="All neighborhoods" value="" />
                {neighborhoods.map((neighborhood) => (
                  <Picker.Item key={neighborhood} label={neighborhood} value={neighborhood} />
                ))}
              </Picker>
            </View>

            <View style={styles.sideFooter}>
              <Pressable
                style={styles.applyButton}
                onPress={() => {
                  setFavoritesOnly(draftFavoritesOnly);
                  setSelectedNeighborhood(draftSelectedNeighborhood);
                  closeMenu();
                }}
              >
                <Text style={styles.applyText}>Apply Filters</Text>
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', flexDirection: 'row' },
  overlayTapArea: { flex: 1 },
  sideMenu: { width: 300, height: '100%', backgroundColor: '#fff', paddingBottom: 24 },
  sideHeader: { height: 60, textAlign: 'center', textAlignVertical: 'center', paddingTop: 18, fontWeight: '700', fontSize: 18, borderBottomWidth: 1, borderColor: '#e6ecf5', backgroundColor: '#f7f9fc' },
  sectionTitle: { fontSize: 14, textTransform: 'uppercase', color: '#555', letterSpacing: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1.5, borderColor: '#d9d9d9', borderRadius: 5, marginHorizontal: 16, marginBottom: 10 },
  filterRowSelected: { backgroundColor: '#e6f0ff', borderColor: '#1d4ed8' },
  filterLabelGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filterText: { color: '#222', fontSize: 14 },
  iconText: { color: '#8e8e93', fontSize: 16 },
  checkbox: { color: '#8e8e93', fontSize: 18 },
  pickerWrap: { borderWidth: 1.5, borderColor: '#d9d9d9', borderRadius: 5, marginHorizontal: 16, backgroundColor: '#fff', marginBottom: 8 },
  sideFooter: { marginTop: 'auto', paddingHorizontal: 16 },
  applyButton: { backgroundColor: '#007bff', borderRadius: 8, height: 56, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
