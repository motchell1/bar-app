import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useScrollToTop } from '@react-navigation/native';
import { Animated, Easing, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { theme } from '../constants/theme';
import { fetchStartupPayload, StartupPayload } from '../services/api';

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type SpecialItem = NonNullable<StartupPayload['specials']>[string];

function orderedDayKeys(currentDay?: string) {
  const configuredStartIndex = DAYS_FULL.findIndex((day) => day.slice(0, 3).toUpperCase() === currentDay);
  const startIndex = configuredStartIndex >= 0 ? configuredStartIndex : new Date().getDay();
  return Array.from({ length: 7 }, (_, offset) => {
    const dayName = DAYS_FULL[(startIndex + offset + 7) % 7];
    return { dayKey: dayName.slice(0, 3).toUpperCase(), dayLabel: offset === 0 ? `${dayName} (Today)` : dayName };
  });
}

function format12Hour(timeValue?: string | null) {
  if (!timeValue) return null;
  const [hourRaw, minuteRaw] = timeValue.split(':');
  let hour = Number.parseInt(hourRaw, 10);
  const minute = Number.parseInt(minuteRaw, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour === 24) hour = 0;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalizedHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}


function groupSpecialsForUI(specials: SpecialItem[]) {
  const groups = new Map<string, SpecialItem[]>();
  specials.forEach((special) => {
    const specialType = special.special_type || special.type || '';
    const key = [specialType, special.all_day ? 'all-day' : 'timed', special.start_time || '', special.end_time || ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(special);
  });

  return Array.from(groups.values()).map((group) => {
    const base = { ...group[0] };
    const uniqueDescriptions = Array.from(new Set(group.map((s) => (s.description || '').trim()).filter(Boolean)));
    base.description = uniqueDescriptions.join(' • ');
    const hasLive = group.some((s) => s.current_status === 'live' || s.current_status === 'active');
    const hasUpcoming = group.some((s) => s.current_status === 'upcoming');
    const hasPast = group.some((s) => s.current_status === 'past');
    const hasFavorite = group.some((s) => s.favorite === true);
    if (hasLive) base.current_status = 'live';
    else if (hasUpcoming) base.current_status = 'upcoming';
    else if (hasPast) base.current_status = 'past';
    if (hasFavorite) base.favorite = true;
    return base;
  });
}

function iconForType(type?: string) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'food') return ['restaurant-outline'];
  if (normalized === 'drink') return ['wine-outline'];
  if (normalized === 'combo') return ['restaurant-outline', 'wine-outline'];
  return [];
}

function specialMatchesTypeFilters(specialType?: string, selectedTypes: string[] = []) {
  if (!Array.isArray(selectedTypes) || selectedTypes.length === 0) return true;
  const normalizedSpecialType = String(specialType || '').trim().toLowerCase();
  const normalizedSelectedTypes = selectedTypes.map((type) => String(type || '').trim().toLowerCase());
  if (normalizedSpecialType === 'combo') {
    return normalizedSelectedTypes.includes('combo')
      || normalizedSelectedTypes.includes('food')
      || normalizedSelectedTypes.includes('drink');
  }
  return normalizedSelectedTypes.includes(normalizedSpecialType);
}


function LoadingSkeleton() {
  const shimmer = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 950,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: -1,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const translateX = shimmer.interpolate({
    inputRange: [-1, 1],
    outputRange: [-620, 760],
  });

  const skeletonCards = Array.from({ length: 3 });

  return (
    <View style={styles.skeletonList}>
      {skeletonCards.map((_, index) => (
        <View key={`skeleton-${index}`} style={styles.skeletonCard}>
          <View style={styles.skeletonImage} />
          <View style={styles.skeletonContent}>
            <View style={[styles.skeletonLine, { width: '58%', height: 20 }]} />
            <View style={[styles.skeletonLine, { width: '34%', height: 12, marginTop: 8 }]} />
            <View style={[styles.skeletonLine, { width: '100%', height: 52, marginTop: 12 }]} />
            <View style={[styles.skeletonLine, { width: '72%', height: 14, marginTop: 12 }]} />
          </View>
          <Animated.View style={[styles.skeletonShimmer, { transform: [{ translateX }, { rotate: '18deg' }] }]} />
        </View>
      ))}
    </View>
  );
}

function ActiveDot() {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.activeDot, { opacity }]} />;
}

export default function SpecialsScreen() {
  const scrollRef = useRef<any>(null);
  useScrollToTop(scrollRef);

  const [payload, setPayload] = useState<StartupPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dividerY, setDividerY] = useState<number | null>(null);
  const hasScrolledToDivider = useRef(false);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showContent, setShowContent] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedTypesDraft, setSelectedTypesDraft] = useState<string[]>([]);
  const [favoritesOnlyDraft, setFavoritesOnlyDraft] = useState(false);
  const [selectedNeighborhoodDraft, setSelectedNeighborhoodDraft] = useState<string>('');
  const [selectedTypesApplied, setSelectedTypesApplied] = useState<string[]>([]);
  const [favoritesOnlyApplied, setFavoritesOnlyApplied] = useState(false);
  const [selectedNeighborhoodApplied, setSelectedNeighborhoodApplied] = useState<string>('');
  const sideMenuTranslateX = useRef(new Animated.Value(300)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const skeletonOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        hasScrolledToDivider.current = false;
        setError(null);
        setPayload(await fetchStartupPayload());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load specials.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);


  useEffect(() => {
    if (!loading) {
      contentOpacity.setValue(0);
      skeletonOpacity.setValue(1);
      setShowSkeleton(true);
      setShowContent(false);

      Animated.timing(skeletonOpacity, {
        toValue: 0,
        duration: 500,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setShowSkeleton(false);
        setShowContent(true);
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    }
  }, [loading, contentOpacity, skeletonOpacity]);

  const weekDays = useMemo(() => orderedDayKeys(payload?.general_data?.current_day), [payload?.general_data?.current_day]);
  const neighborhoods = useMemo(() => {
    const all = Object.values(payload?.bars || {}).map((b) => b.neighborhood).filter(Boolean);
    return Array.from(new Set(all)).sort((a, b) => a.localeCompare(b));
  }, [payload?.bars]);

  function toggleSelection(current: string[], value: string) {
    return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  }

  function applyFilters() {
    setSelectedTypesApplied(selectedTypesDraft);
    setFavoritesOnlyApplied(favoritesOnlyDraft);
    setSelectedNeighborhoodApplied(selectedNeighborhoodDraft);
    setMenuOpen(false);
  }

  function closeMenuDiscardDraft() {
    setSelectedTypesDraft(selectedTypesApplied);
    setFavoritesOnlyDraft(favoritesOnlyApplied);
    setSelectedNeighborhoodDraft(selectedNeighborhoodApplied);
    setMenuOpen(false);
  }

  function openMenuWithAppliedDrafts() {
    setSelectedTypesDraft(selectedTypesApplied);
    setFavoritesOnlyDraft(favoritesOnlyApplied);
    setSelectedNeighborhoodDraft(selectedNeighborhoodApplied);
    setMenuOpen(true);
  }
  useEffect(() => {
    if (!menuOpen) return;
    sideMenuTranslateX.setValue(300);
    Animated.timing(sideMenuTranslateX, {
      toValue: 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [menuOpen, sideMenuTranslateX]);


  useEffect(() => {
    if (!showContent || dividerY === null || hasScrolledToDivider.current) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo?.({ y: Math.max(0, dividerY - 10), animated: false });
      hasScrolledToDivider.current = true;
    });
  }, [showContent, dividerY, scrollRef]);

  const toolbar = (
    <View style={styles.toolbar}>
      <View style={styles.toolbarInner}>
        <Text style={styles.toolbarTitle} onPress={() => scrollRef.current?.scrollTo?.({ top: 0, animated: true })}>BAR APP</Text>
        <Text style={styles.hamburgerButton} onPress={openMenuWithAppliedDrafts}>☰</Text>
      </View>
    </View>
  );

  return (
    <ScreenContainer scrollViewRef={scrollRef} stickyHeader={toolbar}>
      <Modal visible={menuOpen} transparent animationType="none" onRequestClose={closeMenuDiscardDraft}>
        <Pressable style={styles.sideMenuOverlay} onPress={closeMenuDiscardDraft} />
        <Animated.View style={[styles.sideMenu, { transform: [{ translateX: sideMenuTranslateX }] }]}>
          <Text style={styles.sideMenuHeader}>Filters</Text>
          <View style={styles.sideMenuContent}>
            <Text style={styles.filterSectionTitle}>Special Type</Text>
            {['drink', 'food'].map((type) => (
              <Pressable key={type} style={[styles.filterRow, selectedTypesDraft.includes(type) ? styles.filterRowSelected : null]} onPress={() => setSelectedTypesDraft((prev) => toggleSelection(prev, type))}>
                <Text style={styles.filterLabel}>{type === 'drink' ? 'Drinks' : 'Food'}</Text>
                <Ionicons name={type === 'drink' ? 'wine-outline' : 'restaurant-outline'} size={18} color="#8e8e93" />
              </Pressable>
            ))}
            <Text style={styles.filterSectionTitle}>Favorites</Text>
            <Pressable style={[styles.filterRow, styles.filterRowCompact, favoritesOnlyDraft ? styles.filterRowSelected : null]} onPress={() => setFavoritesOnlyDraft((v) => !v)}>
              <Ionicons name="star-outline" size={18} color="#8e8e93" />
              <Text style={styles.filterLabelCompact}>Favorites only</Text>
            </Pressable>

            <Text style={styles.filterSectionTitle}>Neighborhood</Text>
            <View style={styles.dropdownWrap}>
              <Picker
                selectedValue={selectedNeighborhoodDraft}
                onValueChange={(value: string | number) => setSelectedNeighborhoodDraft(String(value || ''))}
                mode="dropdown"
                style={styles.nativePicker}
              >
                <Picker.Item label="All neighborhoods" value="" />
                {neighborhoods.map((neighborhood) => (
                  <Picker.Item key={neighborhood} label={neighborhood} value={neighborhood} />
                ))}
              </Picker>
            </View>

            <View style={styles.sideMenuFooter}>
              <View style={styles.menuDivider} />
              <Pressable style={styles.applyFiltersButton} onPress={applyFilters}>
                <Text style={styles.applyFiltersButtonText}>Apply Filters</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </Modal>
      {showSkeleton ? <Animated.View style={{ opacity: skeletonOpacity }}><LoadingSkeleton /></Animated.View> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!loading && !error && showContent ? (
        <Animated.View style={{ opacity: contentOpacity }}>
          {weekDays.map(({ dayKey, dayLabel }) => {
            const entries = payload?.specials_by_day?.[dayKey] ?? [];
            return (
              <View key={dayKey} style={styles.daySection}>
                <Text style={styles.dayHeader}>{dayLabel}</Text>
                {entries.length === 0 ? <Text style={styles.noSpecials}>No specials available.</Text> : null}
                {(() => {
                  const cards = entries.map((entry) => {
                    const bar = payload?.bars?.[String(entry.bar_id)];
                    if (!bar) return null;
                    if (selectedNeighborhoodApplied && selectedNeighborhoodApplied !== bar.neighborhood) return null;
                    const specialRows = (entry.specials ?? []).map((id) => payload?.specials?.[String(id)]).filter(Boolean) as SpecialItem[];
                    const isBarFavorite = bar.favorite === true;
                                        const specials = groupSpecialsForUI(specialRows).filter((special) => special.description);
                    const filteredSpecials = specials.filter((special) => {
                      const matchesType = specialMatchesTypeFilters(special.special_type || special.type, selectedTypesApplied);
                      const matchesFavorite = !favoritesOnlyApplied || special.favorite === true || isBarFavorite;
                      return matchesType && matchesFavorite;
                    });
                    if (filteredSpecials.length === 0) return null;

                    const hourMeta = payload?.open_hours?.[String(entry.bar_id)]?.[dayKey];
                    const isToday = dayKey === payload?.general_data?.current_day;
                    const isOpen = bar.is_open_now;
                    const hasActiveOrUpcoming = filteredSpecials.some((special) => ['active', 'live', 'upcoming'].includes(String(special.current_status || '').toLowerCase()));

                    return {
                      key: `${dayKey}-${entry.bar_id}`,
                      hasActiveOrUpcoming,
                      node: (
                        <View key={`${dayKey}-${entry.bar_id}`} style={styles.card}>
                          {bar.image_url ? <Image source={{ uri: bar.image_url }} style={styles.cardImage} /> : null}
                          <View style={styles.cardContent}>
                            <View style={styles.headingRow}><Text style={styles.barName}>{bar.name}</Text><Text style={styles.neighborhood}>{bar.neighborhood}</Text></View>
                            <View style={styles.specialsList}>
                              {filteredSpecials.map((special, index) => {
                                const status = (special.current_status ?? '').toLowerCase();
                                const isLive = status === 'active' || status === 'live';
                                return (
                                  <View key={`${index}-${special.description}`} style={[styles.specialItem, isLive ? styles.specialItemLive : null]}>
                                    <View style={[styles.timeBadge, status === 'past' ? styles.timeBadgePast : null]}>
                                      <Text style={[styles.timeBadgeText, status === 'past' ? styles.timeBadgeTextPast : null]}>{special.all_day ? 'ALL DAY' : `${format12Hour(special.start_time) || ''}\n${format12Hour(special.end_time) || ''}`.trim()}</Text>
                                    </View>
                                    <Text style={styles.specialDescription}>{special.description}</Text>
                                    <View style={styles.typeIconWrap}>{iconForType(special.special_type || special.type).map((icon) => <Ionicons key={icon} name={icon as any} size={24} color="#8e8e93" />)}</View>
                                    {isLive ? <ActiveDot /> : null}
                                  </View>
                                );
                              })}
                            </View>
                            {hourMeta?.display_text
                              ? isToday
                                ? <Text style={styles.hours}><Text style={isOpen ? styles.openText : styles.closedText}>{isOpen ? 'Open' : 'Closed'}</Text>{isOpen ? ` • Closes ${format12Hour(hourMeta.close_time) || ''}` : ` • Opens ${format12Hour(hourMeta.open_time) || ''}`}</Text>
                                : <Text style={styles.hours}>Hours: {hourMeta.display_text}</Text>
                              : <Text style={[styles.hours, styles.futureHours]}>Hours unavailable</Text>}
                          </View>
                        </View>
                      )
                    };
                  }).filter(Boolean) as Array<{ key: string; hasActiveOrUpcoming: boolean; node: ReactElement }>;

                  const isFirstDay = dayKey === (weekDays[0]?.dayKey || '');
                  if (!isFirstDay) return cards.map((card) => card.node);

                  const expiredOnly = cards.filter((card) => !card.hasActiveOrUpcoming);
                  const activeOrUpcoming = cards.filter((card) => card.hasActiveOrUpcoming);

                  return (
                    <>
                      {expiredOnly.map((card) => card.node)}
                      {expiredOnly.length > 0 && activeOrUpcoming.length > 0 ? <View style={styles.activeUpcomingDivider} onLayout={(event) => setDividerY(event.nativeEvent.layout.y)}><View style={styles.dividerLine} /><Text style={styles.dividerLabel}>Active + Upcoming Today</Text><View style={styles.dividerLine} /></View> : null}
                      {activeOrUpcoming.map((card) => card.node)}
                    </>
                  );
                })()}
              </View>
            );
          })}
        </Animated.View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({

  toolbar: { backgroundColor: '#007bff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  toolbarInner: { height: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  toolbarTitle: { color: '#fff', fontSize: 16, fontWeight: '700', textTransform: 'uppercase' },
  hamburgerButton: { position: 'absolute', right: 16, top: 10, color: '#fff', fontSize: 24, lineHeight: 28 },
  daySection: { gap: 12 },
  dayHeader: { color: '#636366', fontSize: 16, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: '#ccc', paddingBottom: 10 },
  noSpecials: { color: '#555', fontStyle: 'italic', textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5, marginBottom: 10 },
  cardImage: { width: '100%', height: 180 },
  cardContent: { padding: 16 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  barName: { color: '#111827', fontSize: 21, fontWeight: '700', flex: 1 },
  neighborhood: { color: '#777', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, maxWidth: '45%', textAlign: 'right' },
  specialsList: { gap: 8, marginTop: 12 },
  specialItem: { position: 'relative', backgroundColor: '#f7f9fc', borderWidth: 1, borderColor: '#e6ecf5', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  specialItemLive: { shadowColor: '#ff4d4f', shadowOpacity: 0.55, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 2 },
  activeDot: { position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: 999, backgroundColor: '#ff4d4f' },
  timeBadge: { width: 72, minWidth: 72, height: 36, backgroundColor: '#007bff', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  timeBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 12, includeFontPadding: false },
  timeBadgePast: { backgroundColor: '#ccc' },
  timeBadgeTextPast: { color: '#666' },
  specialDescription: { flex: 1, color: '#111827', fontSize: 13, lineHeight: 18 },
  typeIconWrap: { minWidth: 50, height: 40, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  hours: { color: '#333', fontSize: 13, marginTop: 10 },
  openText: { color: 'green', fontWeight: '700' },
  closedText: { color: 'red', fontWeight: '700' },
  futureHours: { fontWeight: '400' },

  skeletonList: { gap: 14 },
  skeletonCard: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#e5e7eb', position: 'relative' },
  skeletonImage: { height: 180, backgroundColor: '#eef2f7' },
  skeletonContent: { padding: 16 },
  skeletonLine: { backgroundColor: '#eef2f7', borderRadius: 8 },
  skeletonShimmer: { position: 'absolute', top: -140, bottom: -140, width: 220, backgroundColor: 'rgba(255,255,255,0.32)' },
  errorText: { color: '#ef4444', fontSize: 14 },
  activeUpcomingDivider: { marginTop: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#d1d5db' },
  dividerLabel: { color: '#6b7280', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  sideMenuOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  sideMenu: { marginLeft: 'auto', width: 300, height: '100%', backgroundColor: '#fff', paddingBottom: 70 },
  sideMenuHeader: { height: 60, textAlign: 'center', textAlignVertical: 'center', fontWeight: '700', fontSize: 18, borderBottomWidth: 1, borderBottomColor: '#e6ecf5', backgroundColor: '#f7f9fc', paddingTop: 18 },
  sideMenuContent: { padding: 16, gap: 10 },
  filterSectionTitle: { fontSize: 14, textTransform: 'uppercase', color: '#555', letterSpacing: 1, marginTop: 8 },
  filterRow: { borderWidth: 1.5, borderColor: '#d9d9d9', borderRadius: 5, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterRowCompact: { justifyContent: 'flex-start', gap: 8 },
  filterRowSelected: { backgroundColor: '#e6f0ff', borderColor: '#1d4ed8' },
  filterLabel: { color: '#111827' },
  filterLabelCompact: { color: '#111827' },
  dropdownWrap: { borderWidth: 1.5, borderColor: '#d9d9d9', borderRadius: 5, overflow: 'hidden' },
  nativePicker: { backgroundColor: '#fff', color: '#111827' },
  sideMenuFooter: { marginTop: 10, gap: 12 },
  menuDivider: { height: 1, backgroundColor: '#ccc' },
  applyFiltersButton: { backgroundColor: '#007bff', borderRadius: 8, height: 52, alignItems: 'center', justifyContent: 'center' },
  applyFiltersButtonText: { color: '#fff', fontWeight: '700', fontSize: 20 },
});
