const STARTUP_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/getStartupData';
const BAR_DETAILS_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/getBarDetails';
const SPECIAL_REPORT_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/insertUserReport';
const UPDATE_DEVICE_FAVORITE_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/updateDeviceFavorite';

function buildLegacyBarsData(payload) {
  const barsLookup = payload?.bars || {};
  const openHoursLookup = payload?.open_hours || {};
  const specialsLookup = payload?.specials || {};

  return Object.entries(barsLookup).map(([barId, bar]) => {
    const barSpecialsByDay = {};

    Object.entries(specialsLookup).forEach(([specialId, special]) => {
      if (String(special.bar_id) !== String(barId)) return;
      const day = special.day;
      if (!barSpecialsByDay[day]) barSpecialsByDay[day] = [];
      barSpecialsByDay[day].push({
        special_id: Number(specialId),
        all_day: special.all_day,
        start_time: special.start_time,
        end_time: special.end_time,
        description: special.description,
        type: special.special_type,
        current_status: special.current_status,
        favorite: special.favorite
      });
    });

    return {
      bar_id: Number(barId),
      name: bar.name,
      neighborhood: bar.neighborhood,
      latitude: bar.latitude,
      longitude: bar.longitude,
      image_url: bar.image_url,
      website_url: bar.website_url,
      favorite: bar.favorite,
      hours_by_day: openHoursLookup[barId] || {},
      specials_by_day: barSpecialsByDay
    };
  });
}

function buildStartupUrl() {
  const url = new URL(STARTUP_API_URL);
  if (deviceId) {
    url.searchParams.set('device_id', deviceId);
  }
  return url.toString();
}

function buildBarDetailsUrl(barId) {
  const url = new URL(BAR_DETAILS_API_URL);
  url.searchParams.set('bar_id', String(barId));
  return url.toString();
}

async function loadBars() {
  try {
    const response = await fetch(buildStartupUrl());
    const data = await response.json();
    const parsed = typeof data.body === 'string' ? JSON.parse(data.body) : data;
    startupPayload = parsed.startup_payload || null;
    barDetailsById = {};
    mapSelectedDayKey = startupPayload?.general_data?.current_day || null;

    barsData = startupPayload ? buildLegacyBarsData(startupPayload) : [];
    generateNeighborhoodFilters();
  } catch (err) {
    console.error('Failed to load bars:', err);
  } finally {
    isInitialDataLoading = false;
    renderCurrentTabData();
    hideInitialLoadingOverlay();
  }
}

async function loadBarDetails(barId) {
  const normalizedBarId = String(barId);
  if (barDetailsById[normalizedBarId]) {
    return barDetailsById[normalizedBarId];
  }

  const response = await fetch(buildBarDetailsUrl(normalizedBarId));
  const data = await response.json();
  const parsed = typeof data.body === 'string' ? JSON.parse(data.body) : data;
  const payload = parsed.bar_details_payload || null;

  if (payload) {
    barDetailsById[normalizedBarId] = payload;
  }

  return payload;
}

async function persistFavoriteChangeInBackground({ specialId = null, barId = null, isFavorited = false } = {}) {
  if (!deviceId) return;
  if (specialId === null && barId === null) return;

  const payload = {
    device_id: deviceId,
    special_id: specialId === null ? null : Number(specialId),
    bar_id: barId === null ? null : Number(barId),
    is_favorite: Boolean(isFavorited)
  };

  try {
    const response = await fetch(UPDATE_DEVICE_FAVORITE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Failed to persist favorite change:', response.status);
    }
  } catch (err) {
    console.error('Failed to persist favorite change:', err);
  }
}

async function submitSpecialReport(event) {
  event.preventDefault();

  const reasonSelect = document.getElementById('special-report-reason');
  const commentInput = document.getElementById('special-report-comment');
  if (!reasonSelect || !reasonSelect.value || !currentSpecialContext) return;

  const specialId = getSpecialId(
    currentSpecialContext.bar,
    currentSpecialContext.special,
    currentSpecialContext.dayLabel || ''
  );
  const groupedSpecialIds = Array.isArray(currentSpecialContext.special?.grouped_special_ids)
    ? currentSpecialContext.special.grouped_special_ids
      .map((id) => String(id))
      .filter(Boolean)
    : [];
  const specialIdsToReport = groupedSpecialIds.length > 0
    ? Array.from(new Set(groupedSpecialIds))
    : (specialId ? [String(specialId)] : []);
  if (specialIdsToReport.length === 0) return;

  const commentText = commentInput?.value.trim() || '';
  try {
    await Promise.allSettled(specialIdsToReport.map((id) => {
      const barId = currentSpecialContext?.bar?.bar_id ?? currentSpecialContext?.bar?.id ?? null;
      const payload = {
        report_type: 'special',
        bar_id: barId,
        special_id: id,
        reason: reasonSelect.value,
        comment: commentText === '' ? null : commentText,
        user_identifier: userIdentifier
      };

      return fetch(SPECIAL_REPORT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: JSON.stringify(payload)
      });
    }));
  } catch (err) {
    console.error('Failed to submit special report:', err);
  }
  resetSpecialReportForm();
  showReportSuccess();
}

async function submitBarReport(event) {
  event.preventDefault();

  const reasonSelect = document.getElementById('bar-report-reason');
  const commentInput = document.getElementById('bar-report-comment');
  if (!reasonSelect || !reasonSelect.value || !currentBarContext) return;

  const barId = currentBarContext?.bar_id ?? currentBarContext?.id ?? null;
  if (barId === null || barId === undefined) return;

  const commentText = commentInput?.value.trim() || '';

  try {
    const payload = {
      report_type: 'bar',
      bar_id: barId,
      special_id: null,
      reason: reasonSelect.value,
      comment: commentText === '' ? null : commentText,
      user_identifier: userIdentifier
    };

    await fetch(SPECIAL_REPORT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Failed to submit bar report:', err);
  }

  resetBarReportForm();
  showBarReportSuccess();
}
