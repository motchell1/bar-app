const STARTUP_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/getStartupData';
const SPECIAL_REPORT_API_URL = 'https://3kz7x6tvvi.execute-api.us-east-2.amazonaws.com/default/insertUserReport';

function getCurrentDayKey() {
  const dayKeys = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return dayKeys[new Date().getDay()];
}

function shouldUseDemoStartupPayload() {
  const searchText = window?.location?.search || '';
  const search = new URLSearchParams(searchText);
  return search.get('demo') === '1';
}

function buildDemoStartupPayload() {
  const currentDay = getCurrentDayKey();
  const generatedAt = new Date().toISOString();

  return {
    general_data: {
      current_day: currentDay,
      generated_at: generatedAt
    },
    bars: {
      '101': {
        name: 'Demo Taproom',
        neighborhood: 'Downtown',
        image_url: 'https://placehold.co/640x360?text=Demo+Taproom',
        is_open_now: true,
        has_special_this_week: true
      }
    },
    open_hours: {
      '101': {
        [currentDay]: {
          open_time: '11:00',
          close_time: '23:00',
          display_text: '11:00 AM – 11:00 PM'
        }
      }
    },
    specials: {
      '9001': {
        bar_id: 101,
        day: currentDay,
        special_type: 'drink',
        description: '$5 Local Drafts',
        all_day: false,
        start_time: '16:00',
        end_time: '19:00',
        current_status: 'active',
        favorite: false
      },
      '9002': {
        bar_id: 101,
        day: currentDay,
        special_type: 'food',
        description: 'Half-price wings',
        all_day: true,
        start_time: null,
        end_time: null,
        current_status: 'active',
        favorite: false
      }
    },
    specials_by_day: {
      [currentDay]: [
        {
          bar_id: 101,
          specials: [9001, 9002]
        }
      ]
    }
  };
}

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
      image_url: bar.image_url,
      hours_by_day: openHoursLookup[barId] || {},
      specials_by_day: barSpecialsByDay
    };
  });
}

async function loadBars() {
  try {
    if (shouldUseDemoStartupPayload()) {
      startupPayload = buildDemoStartupPayload();
    } else {
      const response = await fetch(STARTUP_API_URL);
      const data = await response.json();
      const parsed = typeof data.body === 'string' ? JSON.parse(data.body) : data;
      startupPayload = parsed.startup_payload || null;
    }

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

  const commentText = commentInput?.value.trim() || '';
  const payload = {
    special_id: specialId,
    reason: reasonSelect.value,
    comment: commentText === '' ? null : commentText,
    user_identifier: userIdentifier
  };

  try {
    await fetch(SPECIAL_REPORT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Failed to submit special report:', err);
  }
  resetSpecialReportForm();
  showReportSuccess();
}
