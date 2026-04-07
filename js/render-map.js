const MAP_DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

let barsMap = null;
let barsMapMarkers = [];
let googleMapsLoaderPromise = null;

function getMapSelectedDayKey() {
  if (mapSelectedDayKey && MAP_DAY_KEYS.includes(mapSelectedDayKey)) {
    return mapSelectedDayKey;
  }
  return startupPayload?.general_data?.current_day || MAP_DAY_KEYS[new Date().getDay()];
}

function getMapDayLabel(dayKey) {
  const index = MAP_DAY_KEYS.indexOf(dayKey);
  const dayName = DAYS_FULL[index] || dayKey;
  if (dayKey === (startupPayload?.general_data?.current_day || '')) {
    return `${dayName} (Today)`;
  }
  return dayName;
}

function shiftMapDay(offset) {
  const current = getMapSelectedDayKey();
  const currentIndex = MAP_DAY_KEYS.indexOf(current);
  if (currentIndex < 0) return;
  const nextIndex = (currentIndex + offset + 7) % 7;
  mapSelectedDayKey = MAP_DAY_KEYS[nextIndex];
  renderMapTab();
}

function initMapDayController() {
  const prevButton = document.getElementById('map-day-prev');
  const nextButton = document.getElementById('map-day-next');
  if (!prevButton || !nextButton) return;

  prevButton.addEventListener('click', () => shiftMapDay(-1));
  nextButton.addEventListener('click', () => shiftMapDay(1));
}

function loadGoogleMapsApi() {
  if (window.google?.maps) {
    return Promise.resolve();
  }

  if (googleMapsLoaderPromise) {
    return googleMapsLoaderPromise;
  }

  const apiKey = startupPayload?.general_data?.google_api_key;
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key is missing from startup payload.'));
  }

  googleMapsLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps JavaScript API.'));
    document.head.appendChild(script);
  });

  return googleMapsLoaderPromise;
}

function clearMapMarkers() {
  barsMapMarkers.forEach((marker) => {
    marker.map = null;
  });
  barsMapMarkers = [];
}

function renderMapTab() {
  const mapContainer = document.getElementById('bars-map');
  const dayLabelNode = document.getElementById('map-day-label');
  const emptyState = document.getElementById('map-empty-state');

  if (!mapContainer || !dayLabelNode || !emptyState) return;

  const selectedDayKey = getMapSelectedDayKey();
  dayLabelNode.textContent = getMapDayLabel(selectedDayKey);

  const barsForDay = startupPayload?.specials_by_day?.[selectedDayKey] || [];
  const filteredBarsForDay = barsForDay.filter((entry) => {
    const bar = startupPayload?.bars?.[String(entry.bar_id)];
    if (!bar) return false;

    if (activeFilters.neighborhoods.length > 0 && !activeFilters.neighborhoods.includes(bar.neighborhood)) {
      return false;
    }

    if (activeFilters.types.length === 0) {
      return true;
    }

    const specialIds = Array.isArray(entry.specials) ? entry.specials : [];
    return specialIds.some((specialId) => {
      const special = startupPayload?.specials?.[String(specialId)];
      const specialType = special?.special_type || special?.type;
      return Boolean(specialType && activeFilters.types.includes(specialType));
    });
  });

  const barsWithCoordinates = filteredBarsForDay
    .map((entry) => startupPayload?.bars?.[String(entry.bar_id)])
    .filter((bar) => Boolean(bar && Number.isFinite(Number(bar.latitude)) && Number.isFinite(Number(bar.longitude))))
    .map((bar) => ({
      name: bar.name,
      neighborhood: bar.neighborhood,
      latitude: Number(bar.latitude),
      longitude: Number(bar.longitude)
    }));

  loadGoogleMapsApi()
    .then(() => {
      if (!barsMap) {
        const mapId = startupPayload?.general_data?.google_map_id || 'DEMO_MAP_ID';
        barsMap = new google.maps.Map(mapContainer, {
          center: { lat: 40.438723047481425, lng: -79.99697911133545 },
          zoom: 4,
          mapId,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false
        });
      }

      clearMapMarkers();

      if (barsWithCoordinates.length === 0) {
        emptyState.style.display = '';
        emptyState.textContent = filteredBarsForDay.length === 0
          ? 'No bars match your current day and filters.'
          : 'No bars with specials and map coordinates for this day.';
        return;
      }

      emptyState.style.display = 'none';

      const bounds = new google.maps.LatLngBounds();
      const AdvancedMarkerElement = google.maps.marker?.AdvancedMarkerElement;
      barsWithCoordinates.forEach((bar) => {
        if (!AdvancedMarkerElement) return;

        const marker = new AdvancedMarkerElement({
          position: { lat: bar.latitude, lng: bar.longitude },
          map: barsMap,
          title: bar.name,
          gmpClickable: true
        });

        const infoWindow = new google.maps.InfoWindow({
          content: `<strong>${bar.name}</strong><br>${bar.neighborhood || ''}`
        });

        marker.addEventListener('gmp-click', () => {
          infoWindow.open({ map: barsMap, anchor: marker });
        });

        barsMapMarkers.push(marker);
        bounds.extend(marker.position);
      });

      if (barsMapMarkers.length === 0) {
        emptyState.style.display = '';
        emptyState.textContent = 'Advanced markers are unavailable. Please try again later.';
        return;
      }

      barsMap.fitBounds(bounds);
      if (barsWithCoordinates.length === 1) {
        barsMap.setZoom(14);
      }
    })
    .catch((err) => {
      emptyState.style.display = '';
      emptyState.textContent = err.message || 'Unable to render map.';
    });
}
