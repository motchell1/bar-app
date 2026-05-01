const DB_ADMIN_SYNC_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/dbAdminSync';
const GENERATE_CANDIDATE_SPECIALS_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/generateCandidateSpecials';

(function initAdminPage() {
  const backButton = document.getElementById('admin-back-button');
  const homeButton = document.getElementById('admin-home-button');
  const titleElement = document.getElementById('admin-title');
  const screenElement = document.getElementById('admin-screen');
  if (!backButton || !homeButton || !titleElement || !screenElement) return;

  const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  const CANDIDATE_DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const CANDIDATE_DAY_ALIASES = {
    MONDAY: 'MON',
    TUESDAY: 'TUE',
    WEDNESDAY: 'WED',
    THURSDAY: 'THU',
    FRIDAY: 'FRI',
    SATURDAY: 'SAT',
    SUNDAY: 'SUN',
    MON: 'MON',
    TUE: 'TUE',
    WED: 'WED',
    THU: 'THU',
    FRI: 'FRI',
    SAT: 'SAT',
    SUN: 'SUN'
  };
  const ADMIN_TIMEZONE = 'America/New_York';
  const ADMIN_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: ADMIN_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
  const DAY_LABELS = {
    MONDAY: 'Mon',
    TUESDAY: 'Tue',
    WEDNESDAY: 'Wed',
    THURSDAY: 'Thu',
    FRIDAY: 'Fri',
    SATURDAY: 'Sat',
    SUNDAY: 'Sun'
  };

  const state = {
    currentView: 'home',
    loading: false,
    loadingSpecials: false,
    loadingRejectedSpecials: false,
    loadingBars: false,
    barSearchTerm: '',
    specialSearchTerm: '',
    specialFilterActive: 'all',
    specialFilterNeighborhood: 'all',
    specialFilterType: 'all',
    specialFilterAllDay: 'all',
    updatingCandidateId: null,
    editingCandidateId: null,
    savingCandidate: false,
    actionRejectedCandidateId: null,
    actionSpecialId: null,
    detailSpecials: [],
    detailEditing: false,
    savingSpecial: false,
    actionBarId: null,
    allBars: [],
    detailBar: null,
    detailOpenHours: [],
    detailBarEditing: false,
    savingBar: false,
    generatingBarId: null,
    generatingBarSecondsElapsed: 0,
    generateResultPayload: null,
    runs: [],
    pendingApprovalCount: 0,
    confirmingDeleteRunId: null,
    deletingRunId: null,
    rejectedSpecials: [],
    allSpecials: [],
    groupedSpecials: [],
    specialManagementSort: { key: 'neighborhood', direction: 'asc' },
    barManagementSort: { key: 'name', direction: 'asc' },
    rejectedSpecialSort: { key: 'neighborhood', direction: 'asc' },
    actionRejectedSpecialId: null,
    showRejectedDetails: false,
    creatingSpecial: false,
    savingNewSpecial: false,
    newSpecialForm: {
      neighborhood: '',
      bar_id: '',
      description: '',
      type: 'food',
      days_of_week: [...CANDIDATE_DAY_KEYS],
      all_day: 'Y',
      start_time: '',
      end_time: ''
    },
    errorMessage: ''
  };
  let generateBarTimer = null;

  const SORTABLE_TABLES = {
    'special-management': 'specialManagementSort',
    'bar-management': 'barManagementSort',
    'rejected-special-management': 'rejectedSpecialSort'
  };

  function updateToolbarButtons() {
    const isHomeView = state.currentView === 'home';
    backButton.classList.toggle('is-hidden', isHomeView);
  }

  backButton.addEventListener('click', () => {
    if (state.currentView === 'home') return;
    state.currentView = 'home';
    state.errorMessage = '';
    state.actionRejectedCandidateId = null;
        state.actionRejectedSpecialId = null;
    state.actionSpecialId = null;
    state.detailSpecials = [];
    state.detailEditing = false;
    state.actionBarId = null;
    state.detailBar = null;
    state.detailOpenHours = [];
    state.detailBarEditing = false;
    state.generatingBarId = null;
    state.generatingBarSecondsElapsed = 0;
    state.generateResultPayload = null;
    state.confirmingDeleteRunId = null;
    state.deletingRunId = null;
    state.creatingSpecial = false;
    stopGenerateBarTimer();
    render();
  });

  homeButton.addEventListener('click', () => {
    window.location.assign('/');
  });

  async function callAdminSync(payload) {
    const response = await fetch(DB_ADMIN_SYNC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    const parsed = typeof data.body === 'string' ? JSON.parse(data.body) : data;
    if (!response.ok) {
      throw new Error(parsed?.error || `Request failed with status ${response.status}`);
    }

    if (parsed?.error) {
      throw new Error(parsed.error);
    }

    return parsed;
  }

  function stopGenerateBarTimer() {
    if (generateBarTimer) {
      clearInterval(generateBarTimer);
      generateBarTimer = null;
    }
  }

  function startGenerateBarTimer() {
    stopGenerateBarTimer();
    state.generatingBarSecondsElapsed = 0;
    generateBarTimer = setInterval(() => {
      state.generatingBarSecondsElapsed += 1;
      render();
    }, 1000);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = parseDateValue(value);
    if (!date) return String(value);
    return ADMIN_DATETIME_FORMATTER.format(date);
  }

  function parseDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const epochMs = value < 1e12 ? value * 1000 : value;
      const epochDate = new Date(epochMs);
      return Number.isNaN(epochDate.getTime()) ? null : epochDate;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const utcWithoutTimezoneMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?)?$/);
    if (utcWithoutTimezoneMatch) {
      const [
        ,
        year,
        month,
        day,
        hour = '00',
        minute = '00',
        second = '00',
        fractional = '0'
      ] = utcWithoutTimezoneMatch;
      const milliseconds = Number(fractional.padEnd(3, '0').slice(0, 3));
      const utcMs = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        milliseconds
      );
      const utcDate = new Date(utcMs);
      return Number.isNaN(utcDate.getTime()) ? null : utcDate;
    }

    const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const normalized = raw.replace(' ', 'T');
    const isoValue = hasExplicitTimezone ? normalized : `${normalized}Z`;
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function formatTime(value) {
    if (!value) return '—';
    return String(value).slice(0, 5);
  }

  function escapeAttribute(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getSourceMarkup(source) {
    if (!source) return '—';
    const sourceValue = String(source);
    if (/^https?:\/\//i.test(sourceValue)) {
      return `<a class="admin-source-link" href="${sourceValue}" target="_blank" rel="noopener noreferrer">${sourceValue}</a>`;
    }
    return sourceValue;
  }

  function normalizeDay(day) {
    return String(day || '').trim().toUpperCase();
  }

  function normalizeCandidateDay(day) {
    const normalized = normalizeDay(day);
    return CANDIDATE_DAY_ALIASES[normalized] || '';
  }

  function sortDays(days) {
    return [...new Set(days.map(normalizeDay).filter(Boolean))].sort((a, b) => {
      const aIndex = DAY_ORDER.indexOf(a);
      const bIndex = DAY_ORDER.indexOf(b);
      const safeA = aIndex === -1 ? 999 : aIndex;
      const safeB = bIndex === -1 ? 999 : bIndex;
      return safeA - safeB;
    });
  }

  function formatDayGroup(days) {
    const sorted = sortDays(days);
    if (!sorted.length) return '—';
    if (sorted.length === 7) return 'Mon-Sun';

    const labels = sorted.map((day) => DAY_LABELS[day] || day.slice(0, 3));

    const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
    const weekends = ['SATURDAY', 'SUNDAY'];
    const weekdayMatch = weekdays.every((day) => sorted.includes(day)) && sorted.length === 5;
    const weekendMatch = weekends.every((day) => sorted.includes(day)) && sorted.length === 2;

    if (weekdayMatch) return 'Mon-Fri';
    if (weekendMatch) return 'Sat-Sun';

    return labels.join(', ');
  }

  function getSortState(tableName) {
    const sortKey = SORTABLE_TABLES[tableName];
    return sortKey ? state[sortKey] : null;
  }

  function getSortIndicator(tableName, columnKey) {
    const sortState = getSortState(tableName);
    if (!sortState || sortState.key !== columnKey) return '';
    return sortState.direction === 'asc' ? ' ▲' : ' ▼';
  }

  function toggleSort(tableName, columnKey) {
    const sortKey = SORTABLE_TABLES[tableName];
    if (!sortKey) return;
    const current = state[sortKey];
    const nextDirection = current.key === columnKey && current.direction === 'asc' ? 'desc' : 'asc';
    state[sortKey] = { key: columnKey, direction: nextDirection };
  }

  function toTimestamp(value) {
    const parsedDate = parseDateValue(value);
    if (!parsedDate) return 0;
    const parsed = parsedDate.getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function toTimeNumber(value) {
    const [hours, minutes] = String(value || '').split(':').map((part) => Number(part));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
    return (hours * 60) + minutes;
  }

  function specialSortValue(row, key) {
    if (key === 'matched_candidate_count' || key === 'missed_run_count') return Number(row[key]) || 0;
    if (key === 'days_of_week') return formatDayGroup(row.days_of_week || []);
    if (key === 'insert_date' || key === 'update_date') return toTimestamp(row[key]);
    if (key === 'start_time' || key === 'end_time') return toTimeNumber(row[key]);
    return String(row[key] || '').toLowerCase();
  }

  function barSortValue(row, key) {
    if (key === 'last_special_candidate_run' || key === 'insert_date' || key === 'update_date') return toTimestamp(row[key]);
    return String(row[key] || '').toLowerCase();
  }

  function rejectedSortValue(row, key) {
    if (key === 'insert_date') return toTimestamp(row[key]);
    if (key === 'start_time' || key === 'end_time') return toTimeNumber(row[key]);
    if (key === 'days_of_week') return formatDayGroup(row.days_of_week || []);
    if (key === 'web_ai_search_matches' || key === 'web_crawl_matches') return Number(row[key]) || 0;
    return String(row[key] || '').toLowerCase();
  }

  function sortRows(rows, tableName, valueResolver) {
    const sortState = getSortState(tableName);
    if (!sortState?.key) return [...rows];
    const directionFactor = sortState.direction === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      const valueA = valueResolver(a, sortState.key);
      const valueB = valueResolver(b, sortState.key);
      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return (valueA - valueB) * directionFactor;
      }
      return String(valueA).localeCompare(String(valueB)) * directionFactor;
    });
  }

  function groupSpecials(specials) {
    const grouped = new Map();

    specials.forEach((special) => {
      const key = [
        special.neighborhood || '',
        special.bar_name || '',
        special.description || '',
        special.all_day || '',
        special.start_time || '',
        special.end_time || '',
        special.type || '',
        special.is_active || '',
        special.insert_method || ''
      ].join('||');

      if (!grouped.has(key)) {
        grouped.set(key, {
          neighborhood: special.neighborhood,
          bar_name: special.bar_name,
          description: special.description,
          all_day: special.all_day,
          start_time: special.start_time,
          end_time: special.end_time,
          type: special.type,
          is_active: special.is_active,
          insert_method: special.insert_method,
          insert_date: special.insert_date,
          update_date: special.update_date,
          matched_candidate_count: 0,
          missed_run_count: 0,
          daySet: new Set(),
          specials: []
        });
      }

      const row = grouped.get(key);
      row.specials.push(special);
      row.matched_candidate_count += Number(special.matched_candidate_count || 0);
      row.missed_run_count = Math.max(row.missed_run_count, Number(special.missed_run_count || 0));
      row.daySet.add(normalizeDay(special.day_of_week));

      const rowInsert = toTimestamp(row.insert_date);
      const specialInsert = toTimestamp(special.insert_date);
      if (!row.insert_date || specialInsert < rowInsert) {
        row.insert_date = special.insert_date;
      }

      const rowUpdate = toTimestamp(row.update_date);
      const specialUpdate = toTimestamp(special.update_date);
      if (!row.update_date || specialUpdate > rowUpdate) {
        row.update_date = special.update_date;
      }
    });

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        days_of_week: sortDays([...row.daySet]),
        representative_special_id: row.specials[0]?.special_id
      }))
      .sort((a, b) => {
        const neighborhoodCompare = String(a.neighborhood || '').localeCompare(String(b.neighborhood || ''));
        if (neighborhoodCompare !== 0) return neighborhoodCompare;
        const barCompare = String(a.bar_name || '').localeCompare(String(b.bar_name || ''));
        if (barCompare !== 0) return barCompare;
        const descriptionCompare = String(a.description || '').localeCompare(String(b.description || ''));
        if (descriptionCompare !== 0) return descriptionCompare;
        const dateA = toTimestamp(a.insert_date);
        const dateB = toTimestamp(b.insert_date);
        return dateA - dateB;
      });
  }

  function dedupeSpecialsById(specials) {
    const byId = new Map();
    specials.forEach((special) => {
      const id = Number(special.special_id);
      if (!id) return;

      if (!byId.has(id)) {
        byId.set(id, special);
        return;
      }

      const current = byId.get(id);
      const currentHasCandidate = current.special_candidate_id !== null && current.special_candidate_id !== undefined;
      const nextHasCandidate = special.special_candidate_id !== null && special.special_candidate_id !== undefined;
      if (!currentHasCandidate && nextHasCandidate) {
        byId.set(id, special);
      }
    });
    return [...byId.values()];
  }

  async function loadUnapprovedSpecials() {
    state.loading = true;
    state.errorMessage = '';
    render();

    try {
      const result = await callAdminSync({ mode: 'get_unapproved_special_candidates' });
      state.runs = Array.isArray(result?.runs) ? result.runs : [];
      state.pendingApprovalCount = Number(result?.not_approved_count) || 0;
    } catch (err) {
      console.error('Failed to load unapproved specials:', err);
      state.errorMessage = err?.message || 'Failed to load unapproved specials.';
      state.pendingApprovalCount = 0;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function loadAllSpecials() {
    state.loadingSpecials = true;
    state.errorMessage = '';
    render();

    try {
      const result = await callAdminSync({ mode: 'get_all_specials' });
      const rawSpecials = Array.isArray(result?.specials) ? result.specials : [];
      state.allSpecials = dedupeSpecialsById(rawSpecials);
      state.groupedSpecials = groupSpecials(state.allSpecials);
    } catch (err) {
      console.error('Failed to load all specials:', err);
      state.errorMessage = err?.message || 'Failed to load specials.';
    } finally {
      state.loadingSpecials = false;
      render();
    }
  }

  async function loadRejectedSpecials() {
    state.loadingRejectedSpecials = true;
    state.errorMessage = '';
    render();

    try {
      const result = await callAdminSync({ mode: 'get_rejected_special_candidates' });
      state.rejectedSpecials = Array.isArray(result?.specials) ? result.specials : [];
    } catch (err) {
      console.error('Failed to load rejected specials:', err);
      state.errorMessage = err?.message || 'Failed to load rejected specials.';
    } finally {
      state.loadingRejectedSpecials = false;
      render();
    }
  }

  async function removeRejectedSpecialCandidate(specialCandidateId) {
    state.errorMessage = '';
    render();
    try {
      await callAdminSync({
        mode: 'remove_rejected_special_candidate',
        special_candidate_id: specialCandidateId
      });
      await loadRejectedSpecials();
    } catch (err) {
      console.error('Failed to remove rejected special candidate:', err);
      state.errorMessage = err?.message || 'Failed to remove rejected special candidate.';
      render();
    }
  }

  async function loadAllBars() {
    state.loadingBars = true;
    state.errorMessage = '';
    render();

    try {
      const result = await callAdminSync({ mode: 'get_all_bars' });
      state.allBars = Array.isArray(result?.bars) ? result.bars : [];
    } catch (err) {
      console.error('Failed to load all bars:', err);
      state.errorMessage = err?.message || 'Failed to load bars.';
    } finally {
      state.loadingBars = false;
      render();
    }
  }

  async function loadBarDetails(barId) {
    state.errorMessage = '';
    try {
      const result = await callAdminSync({ mode: 'get_bar_details', bar_id: barId });
      state.detailBar = result?.bar || null;
      state.detailOpenHours = Array.isArray(result?.open_hours) ? result.open_hours : [];
    } catch (err) {
      console.error('Failed to load bar details:', err);
      state.errorMessage = err?.message || 'Failed to load bar details.';
      state.detailBar = null;
      state.detailOpenHours = [];
    }
  }

  async function updateCandidateApproval(specialCandidateId, approvalStatus) {
    state.updatingCandidateId = specialCandidateId;
    state.errorMessage = '';
    render();

    try {
      await callAdminSync({
        mode: 'update_special_candidate_approval',
        special_candidate_id: specialCandidateId,
        approval_status: approvalStatus
      });
      await loadUnapprovedSpecials();
    } catch (err) {
      console.error('Failed to update candidate approval:', err);
      state.errorMessage = err?.message || 'Failed to update candidate approval status.';
    } finally {
      state.updatingCandidateId = null;
      render();
    }
  }

  async function confirmCandidateMatch(specialCandidateId, specialId) {
    state.updatingCandidateId = specialCandidateId;
    state.errorMessage = '';
    render();

    try {
      await callAdminSync({
        mode: 'confirm_special_candidate_match',
        special_candidate_id: specialCandidateId,
        special_id: specialId
      });
      await loadUnapprovedSpecials();
    } catch (err) {
      console.error('Failed to confirm candidate match:', err);
      state.errorMessage = err?.message || 'Failed to confirm candidate match.';
    } finally {
      state.updatingCandidateId = null;
      render();
    }
  }

  async function saveCandidateUpdates(payload) {
    state.savingCandidate = true;
    state.errorMessage = '';
    render();

    try {
      await callAdminSync({ mode: 'update_special_candidate', ...payload });
      await loadUnapprovedSpecials();
      state.editingCandidateId = null;
    } catch (err) {
      console.error('Failed to update candidate:', err);
      state.errorMessage = err?.message || 'Failed to update candidate.';
      render();
    } finally {
      state.savingCandidate = false;
      render();
    }
  }

  async function saveSpecialUpdates(payloads) {
    const updates = Array.isArray(payloads) ? payloads : [payloads];
    state.savingSpecial = true;
    state.errorMessage = '';
    render();

    try {
      for (const payload of updates) {
        await callAdminSync({ mode: 'update_special', ...payload });
      }
      await loadAllSpecials();
      if (state.detailSpecials.length) {
        const detailIds = new Set(state.detailSpecials.map((row) => row.special_id));
        state.detailSpecials = state.allSpecials.filter((row) => detailIds.has(row.special_id));
      }
      state.detailEditing = false;
    } catch (err) {
      console.error('Failed to update special:', err);
      state.errorMessage = err?.message || 'Failed to update special.';
    } finally {
      state.savingSpecial = false;
      render();
    }
  }

  async function createSpecial(payload) {
    state.savingNewSpecial = true;
    state.errorMessage = '';
    render();

    try {
      await callAdminSync({ mode: 'insert_special', ...payload });
      await loadAllSpecials();
      state.creatingSpecial = false;
      state.newSpecialForm = {
        neighborhood: '',
        bar_id: '',
        description: '',
        type: 'food',
        days_of_week: [...CANDIDATE_DAY_KEYS],
        all_day: 'Y',
        start_time: '',
        end_time: ''
      };
    } catch (err) {
      console.error('Failed to create special:', err);
      state.errorMessage = err?.message || 'Failed to create special.';
    } finally {
      state.savingNewSpecial = false;
      render();
    }
  }

  async function deleteSpecials(specialIds) {
    const ids = Array.isArray(specialIds) ? specialIds : [specialIds];
    const validIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (!validIds.length) return;

    state.savingSpecial = true;
    state.errorMessage = '';
    render();

    try {
      for (const specialId of validIds) {
        await callAdminSync({ mode: 'delete_special', special_id: specialId });
      }
      await loadAllSpecials();
      state.detailSpecials = [];
      state.detailEditing = false;
    } catch (err) {
      console.error('Failed to delete special:', err);
      state.errorMessage = err?.message || 'Failed to delete special.';
    } finally {
      state.savingSpecial = false;
      render();
    }
  }

  async function rejectSpecials(specialIds) {
    const ids = Array.isArray(specialIds) ? specialIds : [specialIds];
    const validIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (!validIds.length) return;

    state.savingSpecial = true;
    state.errorMessage = '';
    render();

    try {
      for (const specialId of validIds) {
        await callAdminSync({ mode: 'reject_special', special_id: specialId });
      }
      await loadAllSpecials();
      state.detailSpecials = [];
      state.detailEditing = false;
    } catch (err) {
      console.error('Failed to reject special:', err);
      state.errorMessage = err?.message || 'Failed to reject special.';
    } finally {
      state.savingSpecial = false;
      render();
    }
  }

  async function saveBarUpdates(barPayload, openHoursRows) {
    state.savingBar = true;
    state.errorMessage = '';
    render();

    try {
      if (barPayload && Object.keys(barPayload).length > 1) {
        await callAdminSync({ mode: 'update_bar', ...barPayload });
      }
      if (Array.isArray(openHoursRows) && openHoursRows.length) {
        await callAdminSync({
          mode: 'update_open_hours',
          bar_id: barPayload.bar_id,
          open_hours_rows: openHoursRows
        });
      }
      await loadAllBars();
      await loadBarDetails(barPayload.bar_id);
      state.detailBarEditing = false;
    } catch (err) {
      console.error('Failed to update bar:', err);
      state.errorMessage = err?.message || 'Failed to update bar.';
    } finally {
      state.savingBar = false;
      render();
    }
  }

  async function generateCandidateSpecialsForBar(barId) {
    const bar = state.allBars.find((row) => Number(row.bar_id) === Number(barId));
    if (!bar) throw new Error('Bar details are unavailable. Please refresh and try again.');
    const homepageUrl = String(bar.homepage_url || bar.website_url || bar.website || '').trim();
    if (!homepageUrl) throw new Error('This bar does not have a website URL, so a candidate run cannot be generated.');

    state.generatingBarId = Number(barId);
    state.generateResultPayload = null;
    state.errorMessage = '';
    startGenerateBarTimer();
    render();

    try {
      const response = await fetch(GENERATE_CANDIDATE_SPECIALS_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: JSON.stringify({
          bar_id: Number(bar.bar_id),
          bar_name: String(bar.name || '').trim(),
          neighborhood: String(bar.neighborhood || '').trim(),
          homepage_url: homepageUrl
        })
      });
      const data = await response.json();
      const parsed = typeof data.body === 'string' ? JSON.parse(data.body) : data;
      if (!response.ok) {
        throw new Error(parsed?.error || `Request failed with status ${response.status}`);
      }
      if (parsed?.error) {
        throw new Error(parsed.error);
      }
      state.generateResultPayload = parsed;
      await loadAllBars();
    } catch (err) {
      console.error('Failed to generate candidate specials:', err);
      state.errorMessage = err?.message || 'Failed to generate candidate specials for this bar.';
      state.generateResultPayload = null;
    } finally {
      stopGenerateBarTimer();
      state.generatingBarId = null;
      state.generatingBarSecondsElapsed = 0;
      render();
    }
  }

  async function deleteSpecialCandidatesForRun(runId) {
    const parsedRunId = Number(runId);
    if (!parsedRunId) return;

    state.deletingRunId = parsedRunId;
    state.errorMessage = '';
    render();

    try {
      await callAdminSync({
        mode: 'delete_special_candidate_run',
        run_id: parsedRunId
      });
      state.confirmingDeleteRunId = null;
      await loadUnapprovedSpecials();
    } catch (err) {
      console.error('Failed to delete candidate run:', err);
      state.errorMessage = err?.message || 'Failed to delete candidate run.';
    } finally {
      state.deletingRunId = null;
      render();
    }
  }

  function getSpecialById(specialId) {
    return state.allSpecials.find((row) => row.special_id === specialId) || null;
  }

  function getGroupedRowByRepresentativeId(specialId) {
    return state.groupedSpecials.find((row) => row.representative_special_id === specialId) || null;
  }

  function getSpecialActionMenuMarkup() {
    if (!state.actionSpecialId) return '';
    return `
      <div class="admin-modal-backdrop" data-close-action-menu="true">
        <div class="admin-modal" role="dialog" aria-label="Special actions">
          <h3>Special Actions</h3>
          <button type="button" class="admin-tool-button" data-special-action="view-details" data-special-id="${state.actionSpecialId}">View Details</button>
          <button type="button" class="admin-tool-button" data-special-action="activate" data-special-id="${state.actionSpecialId}">Activate Special</button>
          <button type="button" class="admin-tool-button" data-special-action="deactivate" data-special-id="${state.actionSpecialId}">Deactivate Special</button>
          <button type="button" class="admin-tool-button danger" data-special-action="reject" data-special-id="${state.actionSpecialId}">Reject Special</button>
          <button type="button" class="admin-tool-button danger" data-special-action="delete" data-special-id="${state.actionSpecialId}">Delete Special</button>
          <button type="button" class="admin-secondary-btn" data-close-action-menu="true">Close</button>
        </div>
      </div>
    `;
  }

  function getBarActionMenuMarkup() {
    if (!state.actionBarId) return '';
    const isGenerating = state.generatingBarId === Number(state.actionBarId);
    return `
      <div class="admin-modal-backdrop" data-close-bar-action-menu="true">
        <div class="admin-modal" role="dialog" aria-label="Bar actions">
          <h3>Bar Actions</h3>
          <button type="button" class="admin-tool-button" data-bar-action="view-details" data-bar-id="${state.actionBarId}">View Details</button>
          <button type="button" class="admin-tool-button" data-bar-action="activate" data-bar-id="${state.actionBarId}">Activate Bar</button>
          <button type="button" class="admin-tool-button" data-bar-action="deactivate" data-bar-id="${state.actionBarId}">Deactivate Bar</button>
          <button type="button" class="admin-tool-button" data-bar-action="generate-candidates" data-bar-id="${state.actionBarId}" ${isGenerating ? 'disabled' : ''}>
            ${isGenerating ? 'Generating Candidate Specials...' : 'Generate Candidate Specials'}
          </button>
          <button type="button" class="admin-secondary-btn" data-close-bar-action-menu="true">Close</button>
        </div>
      </div>
    `;
  }

  function getCreateSpecialModalMarkup() {
    if (!state.creatingSpecial) return '';

    const neighborhoodOptions = [...new Set(state.allBars
      .map((row) => String(row.neighborhood || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const newSpecialNeighborhood = String(state.newSpecialForm.neighborhood || '');
    const availableBars = state.allBars
      .filter((bar) => !newSpecialNeighborhood || String(bar.neighborhood || '') === newSpecialNeighborhood)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    return `
      <div class="admin-modal-backdrop" data-close-create-special-modal="true">
        <div class="admin-modal" role="dialog" aria-label="Create special">
          <h3>Create New Special</h3>
          <label>Neighborhood
            <select class="admin-input" data-new-special-field="neighborhood">
              <option value="">Select neighborhood</option>
              ${neighborhoodOptions.map((name) => `<option value="${escapeAttribute(name)}" ${newSpecialNeighborhood === name ? 'selected' : ''}>${name}</option>`).join('')}
            </select>
          </label>
          <label>Bar
            <select class="admin-input" data-new-special-field="bar_id" ${newSpecialNeighborhood ? '' : 'disabled'}>
              <option value="">Select bar</option>
              ${availableBars.map((bar) => `<option value="${bar.bar_id}" ${String(state.newSpecialForm.bar_id) === String(bar.bar_id) ? 'selected' : ''}>${bar.name}</option>`).join('')}
            </select>
          </label>
          <label>Description
            <input class="admin-input" data-new-special-field="description" value="${escapeAttribute(state.newSpecialForm.description)}" />
          </label>
          <label>Type
            <select class="admin-input" data-new-special-field="type">
              <option value="food" ${state.newSpecialForm.type === 'food' ? 'selected' : ''}>food</option>
              <option value="drink" ${state.newSpecialForm.type === 'drink' ? 'selected' : ''}>drink</option>
              <option value="combo" ${state.newSpecialForm.type === 'combo' ? 'selected' : ''}>combo</option>
            </select>
          </label>
          <div class="admin-day-checkboxes">
            ${CANDIDATE_DAY_KEYS.map((day) => `
              <label><input type="checkbox" data-new-special-day="${day}" ${state.newSpecialForm.days_of_week.includes(day) ? 'checked' : ''}/> ${day}</label>
            `).join('')}
          </div>
          <label>All Day
            <select class="admin-input" data-new-special-field="all_day">
              <option value="Y" ${state.newSpecialForm.all_day === 'Y' ? 'selected' : ''}>Y</option>
              <option value="N" ${state.newSpecialForm.all_day === 'N' ? 'selected' : ''}>N</option>
            </select>
          </label>
          <label>Start Time
            <input class="admin-input" placeholder="HH:MM" data-new-special-field="start_time" value="${escapeAttribute(state.newSpecialForm.start_time)}"/>
          </label>
          <label>End Time
            <input class="admin-input" placeholder="HH:MM" data-new-special-field="end_time" value="${escapeAttribute(state.newSpecialForm.end_time)}"/>
          </label>
          <div class="admin-actions-row">
            <button type="button" class="admin-action-btn approve" data-new-special-save ${state.savingNewSpecial ? 'disabled' : ''}>Save New Special</button>
            <button type="button" class="admin-secondary-btn" data-close-create-special-modal="true" ${state.savingNewSpecial ? 'disabled' : ''}>Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  function getDetailModalMarkup() {
    if (!state.detailSpecials.length) return '';
    const specials = [...state.detailSpecials].sort((a, b) => {
      const aIndex = DAY_ORDER.indexOf(normalizeDay(a.day_of_week));
      const bIndex = DAY_ORDER.indexOf(normalizeDay(b.day_of_week));
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });

    const renderValue = (special, key, fallback = '—') => {
      if (state.detailEditing && ['day_of_week', 'all_day', 'start_time', 'end_time', 'description', 'type', 'is_active'].includes(key)) {
        if (key === 'day_of_week') {
          const selectedDays = [...new Set(state.detailSpecials.map((row) => normalizeDay(row.day_of_week)).filter(Boolean))];
          return `
            <span class="admin-day-checkboxes">
              ${DAY_ORDER.map((day) => `
                <label>
                  <input type="checkbox" data-detail-day="${day}" ${selectedDays.includes(day) ? 'checked' : ''} />
                  ${CANDIDATE_DAY_ALIASES[day] || day}
                </label>
              `).join(' ')}
            </span>
          `;
        }
        if (key === 'type') {
          const normalizedType = String(special[key] || '').trim().toLowerCase();
          const resolvedType = ['drink', 'food', 'combo'].includes(normalizedType) ? normalizedType : 'unknown';
          return `
            <select class="admin-input" data-special-id="${special.special_id}" data-special-field="type">
              <option value="drink" ${resolvedType === 'drink' ? 'selected' : ''}>drink</option>
              <option value="food" ${resolvedType === 'food' ? 'selected' : ''}>food</option>
              <option value="combo" ${resolvedType === 'combo' ? 'selected' : ''}>combo</option>
              <option value="unknown" ${resolvedType === 'unknown' ? 'selected' : ''}>unknown</option>
            </select>
          `;
        }
        return `<input class="admin-input" data-special-id="${special.special_id}" data-special-field="${key}" value="${special[key] ?? ''}" />`;
      }
      return special[key] === null || special[key] === undefined || special[key] === '' ? fallback : String(special[key]);
    };

    const detailsMarkup = specials.map((special, index) => {
      return `
        <section class="admin-special-detail-card">
          <h4>${DAY_LABELS[normalizeDay(special.day_of_week)] || special.day_of_week || 'Unknown Day'} — Special ${special.special_id}</h4>
          <div class="admin-detail-grid">
            <p><strong>Special ID:</strong> ${special.special_id ?? '—'}</p>
            <p><strong>Neighborhood:</strong> ${special.neighborhood || '—'}</p>
            <p><strong>Bar Name:</strong> ${special.bar_name || '—'}</p>
            <p><strong>Description:</strong> ${renderValue(special, 'description')}</p>
            <p><strong>Day of Week:</strong> ${state.detailEditing && index > 0 ? (special.day_of_week || '—') : renderValue(special, 'day_of_week')}</p>
            <p><strong>All Day:</strong> ${renderValue(special, 'all_day')}</p>
            <p><strong>Start Time:</strong> ${renderValue(special, 'start_time')}</p>
            <p><strong>End Time:</strong> ${renderValue(special, 'end_time')}</p>
            <p><strong>Type:</strong> ${renderValue(special, 'type')}</p>
            <p><strong>Is Active:</strong> ${renderValue(special, 'is_active')}</p>
            <p><strong>Insert Method:</strong> ${special.insert_method || '—'}</p>
            <p><strong>Insert Date:</strong> ${formatDateTime(special.insert_date)}</p>
            <p><strong>Update Date:</strong> ${formatDateTime(special.update_date)}</p>
          </div>
        </section>
      `;
    }).join('');

    const allCandidateRows = [];
    specials.forEach((special) => {
      const candidateRows = Array.isArray(special.candidate_rows) ? special.candidate_rows : [];
      candidateRows.forEach((candidate) => {
        const candidateId = candidate.special_candidate_id;
        const duplicate = allCandidateRows.some((existing) => existing.special_candidate_id === candidateId);
        if (!duplicate) {
          allCandidateRows.push(candidate);
        }
      });
    });

    const candidateSectionMarkup = allCandidateRows.length
      ? `
        <section class="admin-special-detail-card">
          <h4>Special Candidate Data</h4>
          <div class="admin-candidate-history">
            <p><strong>All Candidate Rows (${allCandidateRows.length}):</strong></p>
            <div class="admin-candidate-table-wrap">
              <table class="admin-candidate-table">
                <thead>
                  <tr>
                    <th>Candidate ID</th>
                    <th>Run ID</th>
                    <th>Confidence</th>
                    <th>Fetch Method</th>
                    <th>Notes</th>
                    <th>Source</th>
                    <th>Approval Status</th>
                    <th>Insert Date</th>
                    <th>Approval Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${allCandidateRows.map((candidate) => `
                    <tr>
                      <td>${candidate.special_candidate_id ?? '—'}</td>
                      <td>${candidate.run_id ?? '—'}</td>
                      <td>${candidate.confidence ?? '—'}</td>
                      <td>${candidate.fetch_method || '—'}</td>
                      <td>${candidate.notes || '—'}</td>
                      <td>${getSourceMarkup(candidate.source)}</td>
                      <td>${candidate.approval_status || '—'}</td>
                      <td>${formatDateTime(candidate.insert_date)}</td>
                      <td>${formatDateTime(candidate.approval_date)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      `
      : '';

    return `
      <div class="admin-modal-backdrop" data-close-detail-modal="true">
        <div class="admin-modal admin-modal-detail" role="dialog" aria-label="Special detail">
          <h3>Special Details</h3>
          ${detailsMarkup}
          ${candidateSectionMarkup}
          <div class="admin-actions-row">
            ${state.detailEditing
              ? `<button type="button" class="admin-action-btn approve" data-detail-action="save" ${state.savingSpecial ? 'disabled' : ''}>Save</button>`
              : `<button type="button" class="admin-action-btn approve" data-detail-action="edit">Edit</button>`}
            ${state.detailEditing
              ? '<button type="button" class="admin-secondary-btn" data-detail-action="cancel-edit">Cancel</button>'
              : ''}
            <button type="button" class="admin-secondary-btn" data-close-detail-modal="true">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  function getBarDetailModalMarkup() {
    if (!state.detailBar) return '';
    const bar = state.detailBar;
    const renderBarField = (key, label, fallback = '—') => {
      const value = bar[key];
      if (!state.detailBarEditing) {
        const display = value === null || value === undefined || value === '' ? fallback : String(value);
        return `<p><strong>${label}:</strong> ${display}</p>`;
      }

      if (key === 'is_active') {
        const resolved = String(value || '').toUpperCase() === 'Y' ? 'Y' : 'N';
        return `
          <p><strong>${label}:</strong>
            <select class="admin-input" data-bar-field="${key}">
              <option value="Y" ${resolved === 'Y' ? 'selected' : ''}>Y</option>
              <option value="N" ${resolved === 'N' ? 'selected' : ''}>N</option>
            </select>
          </p>
        `;
      }

      return `<p><strong>${label}:</strong> <input class="admin-input" data-bar-field="${key}" value="${escapeAttribute(value ?? '')}" /></p>`;
    };

    const renderOpenHoursRow = (row) => {
      const rowKey = normalizeDay(row.day_of_week);
      if (!state.detailBarEditing) {
        return `
          <tr>
            <td>${row.day_of_week || '—'}</td>
            <td>${formatTime(row.open_time)}</td>
            <td>${formatTime(row.close_time)}</td>
            <td>${row.is_closed || '—'}</td>
            <td>${formatDateTime(row.insert_date)}</td>
            <td>${formatDateTime(row.update_date)}</td>
          </tr>
        `;
      }

      const resolvedClosed = String(row.is_closed || '').toUpperCase() === 'Y' ? 'Y' : 'N';
      return `
        <tr data-open-hours-row="${rowKey}">
          <td>${row.day_of_week || '—'}</td>
          <td><input class="admin-input" data-open-hours-field="open_time" data-open-hours-day="${rowKey}" value="${escapeAttribute(formatTime(row.open_time) === '—' ? '' : formatTime(row.open_time))}" /></td>
          <td><input class="admin-input" data-open-hours-field="close_time" data-open-hours-day="${rowKey}" value="${escapeAttribute(formatTime(row.close_time) === '—' ? '' : formatTime(row.close_time))}" /></td>
          <td>
            <select class="admin-input" data-open-hours-field="is_closed" data-open-hours-day="${rowKey}">
              <option value="N" ${resolvedClosed === 'N' ? 'selected' : ''}>N</option>
              <option value="Y" ${resolvedClosed === 'Y' ? 'selected' : ''}>Y</option>
            </select>
          </td>
          <td>${formatDateTime(row.insert_date)}</td>
          <td>${formatDateTime(row.update_date)}</td>
        </tr>
      `;
    };

    return `
      <div class="admin-modal-backdrop" data-close-bar-detail-modal="true">
        <div class="admin-modal admin-modal-detail" role="dialog" aria-label="Bar detail">
          <h3>Bar Details</h3>
          <section class="admin-special-detail-card">
            <h4>Bar Data</h4>
            <div class="admin-detail-grid">
              <p><strong>Bar ID:</strong> ${bar.bar_id ?? '—'}</p>
              ${renderBarField('name', 'Name')}
              ${renderBarField('neighborhood', 'Neighborhood')}
              ${renderBarField('address', 'Address')}
              ${renderBarField('website', 'Website')}
              ${renderBarField('google_place_id', 'Google Place ID')}
              ${renderBarField('latitude', 'Latitude')}
              ${renderBarField('longitude', 'Longitude')}
              ${renderBarField('is_active', 'Is Active')}
              <p><strong>Last Candidate Run:</strong> ${formatDateTime(bar.last_special_candidate_run)}</p>
              <p><strong>Insert Date:</strong> ${formatDateTime(bar.insert_date)}</p>
              <p><strong>Update Date:</strong> ${formatDateTime(bar.update_date)}</p>
            </div>
          </section>
          <section class="admin-special-detail-card">
            <h4>Open Hours</h4>
            <div class="admin-table-wrap">
              <table class="admin-special-table">
                <thead>
                  <tr>
                    <th>Day of Week</th>
                    <th>Open Time</th>
                    <th>Close Time</th>
                    <th>Is Closed</th>
                    <th>Insert Date</th>
                    <th>Update Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${state.detailOpenHours.map((row) => renderOpenHoursRow(row)).join('')}
                </tbody>
              </table>
            </div>
          </section>
          <div class="admin-actions-row">
            ${state.detailBarEditing
              ? `<button type="button" class="admin-action-btn approve" data-bar-detail-action="save" ${state.savingBar ? 'disabled' : ''}>Save</button>`
              : `<button type="button" class="admin-action-btn approve" data-bar-detail-action="edit">Edit</button>`}
            ${state.detailBarEditing
              ? '<button type="button" class="admin-secondary-btn" data-bar-detail-action="cancel-edit">Cancel</button>'
              : ''}
            <button type="button" class="admin-secondary-btn" data-close-bar-detail-modal="true">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  function buildRunsMarkup() {
    if (state.runs.length === 0) {
      return '<p class="admin-empty">No unapproved specials.</p>';
    }

    return state.runs.map((run) => {
      const sortedSpecials = [...(run.specials || [])].sort((left, right) => {
        const statusPriority = (special) => {
          const approvalStatus = String(special?.approval_status || '').trim().toUpperCase();
          if (approvalStatus === 'NOT_APPROVED') return 0;
          if (approvalStatus === 'AUTO_APPROVED') return 1;
          if (approvalStatus === 'AUTO_REJECTED') return 2;
          return 3;
        };

        const priorityDiff = statusPriority(left) - statusPriority(right);
        if (priorityDiff !== 0) return priorityDiff;

        return Number(left?.special_candidate_id || 0) - Number(right?.special_candidate_id || 0);
      });

      const specialsMarkup = sortedSpecials.map((special) => {
        const candidateId = Number(special.special_candidate_id);
        const approvalStatus = String(special.approval_status || '').trim().toUpperCase();
        const isAutoApproved = approvalStatus === 'AUTO_APPROVED';
        const isAutoRejected = approvalStatus === 'AUTO_REJECTED';
        const isUpdating = state.updatingCandidateId === candidateId;
        const isReadOnlyCandidate = isAutoApproved || isAutoRejected;
        const isEditing = !isReadOnlyCandidate && state.editingCandidateId === candidateId;
        const confidence = special.confidence === null || special.confidence === undefined ? '—' : String(special.confidence);
        const editableValue = (field, fallback = '—') => {
          const value = special[field] ?? '';
          if (isEditing) {
            if (field === 'type') {
              const normalizedType = String(value || '').trim().toLowerCase();
              return `
                <select class="admin-input" data-candidate-id="${candidateId}" data-candidate-field="type">
                  <option value="food" ${normalizedType === 'food' ? 'selected' : ''}>food</option>
                  <option value="drink" ${normalizedType === 'drink' ? 'selected' : ''}>drink</option>
                  <option value="combo" ${normalizedType === 'combo' ? 'selected' : ''}>combo</option>
                </select>
              `;
            }
            if (field === 'days_of_week') {
              const selectedDays = Array.isArray(value)
                ? value.map((day) => normalizeCandidateDay(day)).filter(Boolean)
                : String(value || '')
                  .split(',')
                  .map((day) => normalizeCandidateDay(day))
                  .filter(Boolean);
              return `
                <span>
                  ${CANDIDATE_DAY_KEYS.map((day) => `
                    <label>
                      <input
                        type="checkbox"
                        data-candidate-id="${candidateId}"
                        data-candidate-day="${day}"
                        ${selectedDays.includes(day) ? 'checked' : ''}
                      />
                      ${day}
                    </label>
                  `).join(' ')}
                </span>
              `;
            }
            return `<input class="admin-input" data-candidate-id="${candidateId}" data-candidate-field="${field}" value="${value}" />`;
          }
          if (field === 'days_of_week') {
            const resolvedDays = Array.isArray(value)
              ? value.map((day) => normalizeCandidateDay(day)).filter(Boolean)
              : String(value || '')
                .split(',')
                .map((day) => normalizeCandidateDay(day))
                .filter(Boolean);
            const displayDays = resolvedDays.join(', ');
            return displayDays || fallback;
          }
          return value === '' ? fallback : String(value);
        };

        const matchedSpecials = Array.isArray(special.matched_specials) ? special.matched_specials : [];
        const matchStatus = String(special.match_status || 'NOT_MATCHED').toUpperCase();
        const matchedSpecialsMarkup = matchedSpecials.length
          ? `
            <div class="admin-matched-specials">
              <p><strong>Matched Specials:</strong></p>
              <div class="admin-matched-specials-list">
                ${matchedSpecials.map((matched) => `
                  <article class="admin-matched-special-card">
                    <p><strong>Special ID:</strong> ${matched.special_id ?? '—'}</p>
                    <p><strong>Description Match Score:</strong> ${matched.fuzzy_description_match_score ?? '—'}</p>
                    <p><strong>Day of Week:</strong> ${matched.day_of_week || '—'}</p>
                    <p><strong>Description:</strong> ${matched.description || '—'}</p>
                    <p><strong>All Day:</strong> ${matched.all_day || '—'}</p>
                    <p><strong>Start Time:</strong> ${matched.start_time || '—'}</p>
                    <p><strong>End Time:</strong> ${matched.end_time || '—'}</p>
                    <p><strong>Type:</strong> ${matched.type || '—'}</p>
                    <p><strong>Insert Date:</strong> ${formatDateTime(matched.insert_date)}</p>
                    <p><strong>Update Date:</strong> ${formatDateTime(matched.update_date)}</p>
                    ${(matchStatus === 'MATCH_PENDING')
                      ? `<button class="admin-secondary-btn" type="button" data-candidate-action="confirm-match" data-candidate-id="${candidateId}" data-special-id="${matched.special_id}" ${isUpdating ? 'disabled' : ''}>Confirm Match</button>`
                      : ''}
                  </article>
                `).join('')}
              </div>
            </div>
          `
          : '';


        const showOverrideMatchAction = matchStatus === 'MATCHED';
        return `
          <article class="admin-candidate-card" data-candidate-id="${candidateId}">
            ${(isEditing || isReadOnlyCandidate) ? '' : `
              <button class="admin-icon-btn" type="button" aria-label="Edit special candidate" title="Edit" data-candidate-action="edit" data-candidate-id="${candidateId}" ${isUpdating ? 'disabled' : ''}>
                &#8943;
              </button>
            `}
            <h4>${isEditing ? 'Editing Special Candidate' : (special.description || 'No description')}</h4>
            <p><strong>Special Candidate ID:</strong> ${special.special_candidate_id ?? '—'}</p>
            <p><strong>Status:</strong> ${special.approval_status || 'NOT_APPROVED'}</p>
            <p><strong>Description:</strong> ${editableValue('description')}</p>
            <p><strong>Type:</strong> ${editableValue('type')}</p>
            <p><strong>Days:</strong> ${editableValue('days_of_week', '—')}</p>
            <p><strong>All Day:</strong> ${editableValue('all_day', 'N')}</p>
            <p><strong>Start Time:</strong> ${editableValue('start_time')}</p>
            <p><strong>End Time:</strong> ${editableValue('end_time')}</p>
            <p><strong>Confidence:</strong> ${confidence}</p>
            <p><strong>Method:</strong> ${special.fetch_method || '—'}</p>
            <p><strong>Source:</strong> ${getSourceMarkup(special.source)}</p>
            <p><strong>Notes:</strong> ${special.notes || '—'}</p>
            <p><strong>Match Status:</strong> ${special.match_status || 'NOT_MATCHED'}</p>
            ${matchedSpecialsMarkup}
            ${isReadOnlyCandidate
              ? ''
              : `<div class="admin-actions-row">
                  ${isEditing
                    ? `<button class="admin-action-btn approve" type="button" data-candidate-action="save-edit" data-candidate-id="${candidateId}" ${state.savingCandidate ? 'disabled' : ''}>Save</button>
                       <button class="admin-secondary-btn" type="button" data-candidate-action="cancel-edit" data-candidate-id="${candidateId}" ${state.savingCandidate ? 'disabled' : ''}>Cancel</button>`
                    : `<button class="admin-action-btn approve" type="button" data-action="APPROVED" data-candidate-id="${candidateId}" ${isUpdating ? 'disabled' : ''}>Approve</button>
                       ${showOverrideMatchAction
                         ? `<button class="admin-action-btn approve" type="button" data-action="APPROVED_OVERRIDE_MATCH" data-candidate-id="${candidateId}" ${isUpdating ? 'disabled' : ''}>Approve - Override Match</button>`
                         : ''}
                       <button class="admin-action-btn reject" type="button" data-action="REJECTED" data-candidate-id="${candidateId}" ${isUpdating ? 'disabled' : ''}>Reject</button>`}
                </div>`}
          </article>
        `;
      }).join('');

      const isDeletingRun = Number(state.deletingRunId) === Number(run.run_id);
      return `
        <section class="admin-run-card">
          <div class="admin-run-card-header">
            <h3>Run ${run.run_id} — ${run.bar_name || 'Unknown bar'}</h3>
            <button
              type="button"
              class="admin-icon-btn admin-run-delete-btn"
              aria-label="Delete run ${run.run_id}"
              title="Delete run"
              data-run-action="prompt-delete"
              data-run-id="${run.run_id}"
              ${isDeletingRun ? 'disabled' : ''}
            >
              &times;
            </button>
          </div>
          <p><strong>Neighborhood:</strong> ${run.neighborhood || '—'}</p>
          <p><strong>Bar ID:</strong> ${run.bar_id ?? '—'}</p>
          <p><strong>Total candidates:</strong> ${run.total_candidates ?? '—'}</p>
          <p><strong>Auto Approved Candidates:</strong> ${run.auto_approved_candidates ?? '—'}</p>
          <p><strong>Started:</strong> ${formatDateTime(run.started_at)}</p>
          <p><strong>Completed:</strong> ${formatDateTime(run.completed_at)}</p>
          <div class="admin-candidate-list">${specialsMarkup}</div>
        </section>
      `;
    }).join('');
  }

  function getRunDeleteConfirmationModalMarkup() {
    if (!state.confirmingDeleteRunId) return '';
    const isDeleting = Number(state.deletingRunId) === Number(state.confirmingDeleteRunId);
    return `
      <div class="admin-modal-backdrop" data-close-run-delete-modal="true">
        <div class="admin-modal" role="dialog" aria-label="Delete run confirmation">
          <h3>Delete Candidate Run ${state.confirmingDeleteRunId}</h3>
          <p>This will remove all <code>special_candidate</code> rows for this run. This cannot be undone.</p>
          <div class="admin-actions-row">
            <button
              type="button"
              class="admin-tool-button danger"
              data-run-action="confirm-delete"
              data-run-id="${state.confirmingDeleteRunId}"
              ${isDeleting ? 'disabled' : ''}
            >
              ${isDeleting ? 'Deleting...' : 'Delete Run'}
            </button>
            <button type="button" class="admin-secondary-btn" data-close-run-delete-modal="true" ${isDeleting ? 'disabled' : ''}>Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  function buildSpecialManagementTable() {
    const searchTerm = String(state.specialSearchTerm || '').trim().toLowerCase();
    const filteredSpecials = state.groupedSpecials.filter((row) => {
      const neighborhood = String(row.neighborhood || '').trim();
      const barName = String(row.bar_name || '').trim();
      const type = String(row.type || '').trim().toLowerCase();
      const isActive = String(row.is_active || '').trim().toUpperCase();
      const allDay = String(row.all_day || '').trim().toUpperCase();

      const searchMatches = !searchTerm
        || neighborhood.toLowerCase().includes(searchTerm)
        || barName.toLowerCase().includes(searchTerm);
      if (!searchMatches) return false;

      const activeMatches = state.specialFilterActive === 'all'
        || isActive === state.specialFilterActive;
      if (!activeMatches) return false;

      const neighborhoodMatches = state.specialFilterNeighborhood === 'all'
        || neighborhood === state.specialFilterNeighborhood;
      if (!neighborhoodMatches) return false;

      const typeMatches = state.specialFilterType === 'all'
        || type === state.specialFilterType;
      if (!typeMatches) return false;

      const allDayMatches = state.specialFilterAllDay === 'all'
        || allDay === state.specialFilterAllDay;
      if (!allDayMatches) return false;

      return true;
    });

    if (!filteredSpecials.length) {
      if (searchTerm) {
        return '<p class="admin-empty">No specials match that bar or neighborhood.</p>';
      }
      return '<p class="admin-empty">No specials found.</p>';
    }

    const sortedSpecials = sortRows(filteredSpecials, 'special-management', specialSortValue);
    const rows = sortedSpecials.map((row) => `
      <tr class="admin-special-row" data-special-id="${row.representative_special_id}">
        <td>${row.neighborhood || '—'}</td>
        <td>${row.bar_name || '—'}</td>
        <td>${row.description || '—'}</td>
        <td>${formatDayGroup(row.days_of_week)}</td>
        <td>${row.all_day || '—'}</td>
        <td>${formatTime(row.start_time)}</td>
        <td>${formatTime(row.end_time)}</td>
        <td>${row.type || '—'}</td>
        <td>${row.is_active || '—'}</td>
        <td>${row.insert_method || '—'}</td>
        <td>${row.matched_candidate_count ?? 0}</td>
        <td>${row.missed_run_count ?? 0}</td>
        <td>${formatDateTime(row.insert_date)}</td>
        <td>${formatDateTime(row.update_date)}</td>
      </tr>
    `).join('');

    return `
      <div class="admin-table-wrap">
        <table class="admin-special-table">
          <thead>
            <tr>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="neighborhood">Neighborhood${getSortIndicator('special-management', 'neighborhood')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="bar_name">Bar Name${getSortIndicator('special-management', 'bar_name')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="description">Description${getSortIndicator('special-management', 'description')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="days_of_week">Days of Week${getSortIndicator('special-management', 'days_of_week')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="all_day">All Day${getSortIndicator('special-management', 'all_day')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="start_time">Start Time${getSortIndicator('special-management', 'start_time')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="end_time">End Time${getSortIndicator('special-management', 'end_time')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="type">Type${getSortIndicator('special-management', 'type')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="is_active">Is Active${getSortIndicator('special-management', 'is_active')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="insert_method">Insert Method${getSortIndicator('special-management', 'insert_method')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="matched_candidate_count">Matched Candidates${getSortIndicator('special-management', 'matched_candidate_count')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="missed_run_count">Missed Runs${getSortIndicator('special-management', 'missed_run_count')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="insert_date">Insert Date${getSortIndicator('special-management', 'insert_date')}</th>
              <th class="admin-sortable-header" data-sort-table="special-management" data-sort-key="update_date">Update Date${getSortIndicator('special-management', 'update_date')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${getSpecialActionMenuMarkup()}
      ${getDetailModalMarkup()}
    `;
  }

  function buildBarManagementTable() {
    const searchTerm = String(state.barSearchTerm || '').trim().toLowerCase();
    const filteredBars = state.allBars.filter((bar) => {
      if (!searchTerm) return true;
      const name = String(bar.name || '').toLowerCase();
      const neighborhood = String(bar.neighborhood || '').toLowerCase();
      return name.includes(searchTerm) || neighborhood.includes(searchTerm);
    });

    if (!filteredBars.length) {
      if (searchTerm) return '<p class="admin-empty">No bars match that search.</p>';
      return '<p class="admin-empty">No bars found.</p>';
    }

    const sortedBars = sortRows(filteredBars, 'bar-management', barSortValue);
    const rows = sortedBars.map((bar) => `
      <tr class="admin-bar-row" data-bar-id="${bar.bar_id}">
        <td>${bar.name || '—'}</td>
        <td>${bar.neighborhood || '—'}</td>
        <td>${bar.is_active || '—'}</td>
        <td>${formatDateTime(bar.last_special_candidate_run)}</td>
        <td>${formatDateTime(bar.insert_date)}</td>
        <td>${formatDateTime(bar.update_date)}</td>
      </tr>
    `).join('');

    return `
      <div class="admin-table-wrap">
        <table class="admin-special-table">
          <thead>
            <tr>
              <th class="admin-sortable-header" data-sort-table="bar-management" data-sort-key="name">Name${getSortIndicator('bar-management', 'name')}</th>
              <th class="admin-sortable-header" data-sort-table="bar-management" data-sort-key="neighborhood">Neighborhood${getSortIndicator('bar-management', 'neighborhood')}</th>
              <th class="admin-sortable-header" data-sort-table="bar-management" data-sort-key="is_active">Is Active${getSortIndicator('bar-management', 'is_active')}</th>
              <th class="admin-sortable-header" data-sort-table="bar-management" data-sort-key="last_special_candidate_run">Last Candidate Run${getSortIndicator('bar-management', 'last_special_candidate_run')}</th>
              <th class="admin-sortable-header" data-sort-table="bar-management" data-sort-key="insert_date">Insert Date${getSortIndicator('bar-management', 'insert_date')}</th>
              <th class="admin-sortable-header" data-sort-table="bar-management" data-sort-key="update_date">Update Date${getSortIndicator('bar-management', 'update_date')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${getBarActionMenuMarkup()}
      ${getBarDetailModalMarkup()}
    `;
  }

  function bindApprovalButtons() {
    screenElement.querySelectorAll('[data-action][data-candidate-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const candidateId = Number(button.getAttribute('data-candidate-id'));
        const action = button.getAttribute('data-action');
        if (!candidateId || !action) return;
        updateCandidateApproval(candidateId, action);
      });
    });

    screenElement.querySelectorAll('[data-candidate-action][data-candidate-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const candidateId = Number(button.getAttribute('data-candidate-id'));
        const action = button.getAttribute('data-candidate-action');
        if (!candidateId || !action) return;

        if (action === 'edit') {
          state.editingCandidateId = candidateId;
          render();
          return;
        }

        if (action === 'cancel-edit') {
          state.editingCandidateId = null;
          render();
          return;
        }

        if (action === 'confirm-match') {
          const specialId = Number(button.getAttribute('data-special-id'));
          if (!specialId) return;
          await confirmCandidateMatch(candidateId, specialId);
          return;
        }

        if (action === 'save-edit') {
          const payload = { special_candidate_id: candidateId };
          screenElement.querySelectorAll(`[data-candidate-id="${candidateId}"][data-candidate-field]`).forEach((input) => {
            const field = input.getAttribute('data-candidate-field');
            payload[field] = input.value;
          });
          payload.days_of_week = Array.from(
            screenElement.querySelectorAll(`[data-candidate-id="${candidateId}"][data-candidate-day]:checked`)
          ).map((checkbox) => checkbox.getAttribute('data-candidate-day'));
          await saveCandidateUpdates(payload);
        }
      });
    });

    screenElement.querySelectorAll('[data-run-action][data-run-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.getAttribute('data-run-action');
        const runId = Number(button.getAttribute('data-run-id'));
        if (!action || !runId) return;

        if (action === 'prompt-delete') {
          state.confirmingDeleteRunId = runId;
          render();
          return;
        }

        if (action === 'confirm-delete') {
          await deleteSpecialCandidatesForRun(runId);
        }
      });
    });

    screenElement.querySelectorAll('[data-close-run-delete-modal="true"]').forEach((element) => {
      element.addEventListener('click', (event) => {
        if (event.currentTarget !== event.target) return;
        if (state.deletingRunId) return;
        state.confirmingDeleteRunId = null;
        render();
      });
    });
  }

  function bindSpecialManagementEvents() {
    bindSortableColumnHeaders();
    const defaultNewSpecialForm = () => ({
      neighborhood: '',
      bar_id: '',
      description: '',
      type: 'food',
      days_of_week: [...CANDIDATE_DAY_KEYS],
      all_day: 'Y',
      start_time: '',
      end_time: ''
    });

    const searchInput = screenElement.querySelector('[data-special-search-input]');
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        const { selectionStart, selectionEnd } = event.target;
        state.specialSearchTerm = event.target.value;
        render();
        const nextInput = screenElement.querySelector('[data-special-search-input]');
        if (nextInput) {
          nextInput.focus();
          if (
            typeof selectionStart === 'number'
            && typeof selectionEnd === 'number'
            && typeof nextInput.setSelectionRange === 'function'
          ) {
            nextInput.setSelectionRange(selectionStart, selectionEnd);
          }
        }
      });
    }

    screenElement.querySelectorAll('[data-special-filter]').forEach((select) => {
      select.addEventListener('change', (event) => {
        const filter = event.target.getAttribute('data-special-filter');
        if (filter === 'active') state.specialFilterActive = event.target.value;
        if (filter === 'neighborhood') state.specialFilterNeighborhood = event.target.value;
        if (filter === 'type') state.specialFilterType = event.target.value;
        if (filter === 'all-day') state.specialFilterAllDay = event.target.value;
        render();
      });
    });

    const createToggle = screenElement.querySelector('[data-special-create-toggle]');
    if (createToggle) {
      createToggle.addEventListener('click', () => {
        state.creatingSpecial = true;
        render();
      });
    }

    screenElement.querySelectorAll('[data-close-create-special-modal="true"]').forEach((element) => {
      element.addEventListener('click', (event) => {
        if (event.currentTarget !== event.target) return;
        state.creatingSpecial = false;
        state.newSpecialForm = defaultNewSpecialForm();
        render();
      });
    });

    screenElement.querySelectorAll('[data-new-special-field]').forEach((input) => {
      input.addEventListener('change', (event) => {
        const field = event.target.getAttribute('data-new-special-field');
        if (!field) return;
        state.newSpecialForm[field] = event.target.value;
        if (field === 'neighborhood') {
          state.newSpecialForm.bar_id = '';
        }
        render();
      });
    });

    screenElement.querySelectorAll('[data-new-special-day]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        state.newSpecialForm.days_of_week = Array.from(
          screenElement.querySelectorAll('[data-new-special-day]:checked')
        ).map((input) => input.getAttribute('data-new-special-day'));
      });
    });

    const saveNewSpecialButton = screenElement.querySelector('[data-new-special-save]');
    if (saveNewSpecialButton) {
      saveNewSpecialButton.addEventListener('click', async () => {
        const payload = {
          bar_id: Number(state.newSpecialForm.bar_id),
          description: String(state.newSpecialForm.description || '').trim(),
          type: String(state.newSpecialForm.type || '').trim().toLowerCase(),
          days_of_week: state.newSpecialForm.days_of_week,
          all_day: String(state.newSpecialForm.all_day || 'Y').trim().toUpperCase(),
          start_time: String(state.newSpecialForm.start_time || '').trim(),
          end_time: String(state.newSpecialForm.end_time || '').trim()
        };
        if (!payload.bar_id || !payload.description || !payload.days_of_week.length) {
          state.errorMessage = 'Neighborhood, bar, description, and at least one day are required.';
          render();
          return;
        }
        await createSpecial(payload);
      });
    }

    screenElement.querySelectorAll('.admin-special-row[data-special-id]').forEach((row) => {
      row.addEventListener('click', () => {
        state.actionSpecialId = Number(row.getAttribute('data-special-id'));
        render();
      });
    });

    screenElement.querySelectorAll('[data-close-action-menu="true"]').forEach((element) => {
      element.addEventListener('click', (event) => {
        if (event.currentTarget !== event.target) return;
        state.actionSpecialId = null;
        render();
      });
    });

    screenElement.querySelectorAll('[data-special-action][data-special-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.getAttribute('data-special-action');
        const specialId = Number(button.getAttribute('data-special-id'));
        if (!specialId || !action) return;

        state.actionSpecialId = null;
        if (action === 'view-details') {
          const groupedRow = getGroupedRowByRepresentativeId(specialId);
          state.detailSpecials = groupedRow?.specials || (getSpecialById(specialId) ? [getSpecialById(specialId)] : []);
          state.detailEditing = false;
          render();
          return;
        }

        if (action === 'activate' || action === 'deactivate') {
          const groupedRow = getGroupedRowByRepresentativeId(specialId);
          const updates = (groupedRow?.specials || []).map((special) => ({
            special_id: special.special_id,
            is_active: action === 'activate' ? 'Y' : 'N'
          }));
          await saveSpecialUpdates(updates.length ? updates : [{ special_id: specialId, is_active: action === 'activate' ? 'Y' : 'N' }]);
          return;
        }

        if (action === 'delete') {
          const groupedRow = getGroupedRowByRepresentativeId(specialId);
          const specialIdsToDelete = (groupedRow?.specials || []).map((special) => Number(special.special_id)).filter(Boolean);
          const ids = specialIdsToDelete.length ? specialIdsToDelete : [specialId];
          const deleteCount = ids.length;
          const confirmed = window.confirm(
            deleteCount > 1
              ? `Delete ${deleteCount} specials from the database? This cannot be undone.`
              : 'Delete this special from the database? This cannot be undone.'
          );
          if (!confirmed) return;
          await deleteSpecials(ids);
          return;
        }

        if (action === 'reject') {
          const groupedRow = getGroupedRowByRepresentativeId(specialId);
          const groupedSpecials = groupedRow?.specials || [];
          const targetSpecials = groupedSpecials.length
            ? groupedSpecials
            : (getSpecialById(specialId) ? [getSpecialById(specialId)] : []);
          const hasManualSpecial = targetSpecials.some(
            (special) => String(special?.insert_method || '').toUpperCase() !== 'AUTO'
          );
          if (hasManualSpecial) {
            state.errorMessage = 'Cannot reject a special that is manually created';
            render();
            return;
          }
          const specialIdsToReject = targetSpecials.map((special) => Number(special.special_id)).filter(Boolean);
          const ids = specialIdsToReject.length ? specialIdsToReject : [specialId];
          const rejectCount = ids.length;
          const confirmed = window.confirm(
            rejectCount > 1
              ? `Reject ${rejectCount} specials? This will move them to rejected specials and delete the active specials.`
              : 'Reject this special? This will move it to rejected specials and delete the active special.'
          );
          if (!confirmed) return;
          await rejectSpecials(ids);
        }
      });
    });

    screenElement.querySelectorAll('[data-close-detail-modal="true"]').forEach((element) => {
      element.addEventListener('click', (event) => {
        if (event.currentTarget !== event.target) return;
        state.detailSpecials = [];
        state.detailEditing = false;
        render();
      });
    });

    screenElement.querySelectorAll('[data-detail-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.getAttribute('data-detail-action');
        if (action === 'edit') {
          state.detailEditing = true;
          render();
          return;
        }

        if (action === 'cancel-edit') {
          if (state.detailSpecials.length) {
            const detailIds = new Set(state.detailSpecials.map((row) => row.special_id));
            state.detailSpecials = state.allSpecials.filter((row) => detailIds.has(row.special_id));
          }
          state.detailEditing = false;
          render();
          return;
        }

        if (action === 'save' && state.detailSpecials.length) {
          const payloadBySpecialId = new Map();
          screenElement.querySelectorAll('[data-special-field]').forEach((input) => {
            const field = input.getAttribute('data-special-field');
            const specialId = Number(input.getAttribute('data-special-id'));
            if (!payloadBySpecialId.has(specialId)) {
              payloadBySpecialId.set(specialId, { special_id: specialId });
            }
            payloadBySpecialId.get(specialId)[field] = input.value;
          });
          const updates = [...payloadBySpecialId.values()];
          const selectedDays = [...new Set(Array.from(screenElement.querySelectorAll('[data-detail-day]:checked'))
            .map((input) => normalizeDay(input.getAttribute('data-detail-day')))
            .filter(Boolean))];
          const activeSpecialsByDay = new Map(state.detailSpecials.map((row) => [normalizeDay(row.day_of_week), row]));
          const selectedDaySet = new Set(selectedDays);
          updates.forEach((payload) => {
            const matchingSpecial = state.detailSpecials.find((row) => row.special_id === payload.special_id);
            if (!matchingSpecial) return;
            const day = normalizeDay(matchingSpecial.day_of_week);
            if (!selectedDaySet.has(day)) {
              payload.is_active = 'N';
            } else if (!payload.is_active) {
              payload.is_active = matchingSpecial.is_active || 'Y';
            }
          });
          await saveSpecialUpdates(updates);

          const templateSpecial = state.detailSpecials[0];
          const missingDays = selectedDays.filter((day) => !activeSpecialsByDay.has(day));
          for (const day of missingDays) {
            await createSpecial({
              bar_id: templateSpecial.bar_id,
              description: updates[0]?.description ?? templateSpecial.description ?? '',
              type: updates[0]?.type ?? templateSpecial.type ?? 'food',
              days_of_week: [day],
              all_day: updates[0]?.all_day ?? templateSpecial.all_day ?? 'Y',
              start_time: updates[0]?.start_time ?? templateSpecial.start_time ?? '',
              end_time: updates[0]?.end_time ?? templateSpecial.end_time ?? ''
            });
          }
        }
      });
    });
  }

  function bindBarManagementEvents() {
    bindSortableColumnHeaders();

    const searchInput = screenElement.querySelector('[data-bar-search-input]');
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        const { selectionStart, selectionEnd } = event.target;
        state.barSearchTerm = event.target.value;
        render();
        const nextInput = screenElement.querySelector('[data-bar-search-input]');
        if (nextInput) {
          nextInput.focus();
          if (
            typeof selectionStart === 'number'
            && typeof selectionEnd === 'number'
            && typeof nextInput.setSelectionRange === 'function'
          ) {
            nextInput.setSelectionRange(selectionStart, selectionEnd);
          }
        }
      });
    }

    screenElement.querySelectorAll('.admin-bar-row[data-bar-id]').forEach((row) => {
      row.addEventListener('click', () => {
        state.actionBarId = Number(row.getAttribute('data-bar-id'));
        render();
      });
    });

    screenElement.querySelectorAll('[data-close-bar-action-menu="true"]').forEach((element) => {
      element.addEventListener('click', (event) => {
        if (event.currentTarget !== event.target) return;
        state.actionBarId = null;
        render();
      });
    });

    screenElement.querySelectorAll('[data-bar-action][data-bar-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.getAttribute('data-bar-action');
        const barId = Number(button.getAttribute('data-bar-id'));
        if (!barId || !action) return;

        try {
          state.errorMessage = '';
          state.actionBarId = null;
          if (action === 'view-details') {
            await loadBarDetails(barId);
            state.detailBarEditing = false;
            render();
            return;
          }

          if (action === 'activate' || action === 'deactivate') {
            await callAdminSync({
              mode: 'update_bar',
              bar_id: barId,
              is_active: action === 'activate' ? 'Y' : 'N'
            });
            await loadAllBars();
            render();
            return;
          }

          if (action === 'generate-candidates') {
            await generateCandidateSpecialsForBar(barId);
          }
        } catch (err) {
          console.error('Failed to update bar status:', err);
          state.errorMessage = err?.message || 'Failed to update bar status.';
          render();
        }
      });
    });

    screenElement.querySelectorAll('[data-close-bar-detail-modal="true"]').forEach((element) => {
      element.addEventListener('click', (event) => {
        if (event.currentTarget !== event.target) return;
        state.detailBar = null;
        state.detailOpenHours = [];
        state.detailBarEditing = false;
        render();
      });
    });

    screenElement.querySelectorAll('[data-bar-detail-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.getAttribute('data-bar-detail-action');
        if (!action || !state.detailBar?.bar_id) return;

        if (action === 'edit') {
          state.detailBarEditing = true;
          render();
          return;
        }

        if (action === 'cancel-edit') {
          await loadBarDetails(state.detailBar.bar_id);
          state.detailBarEditing = false;
          render();
          return;
        }

        if (action === 'save') {
          const barPayload = { bar_id: state.detailBar.bar_id };
          screenElement.querySelectorAll('[data-bar-field]').forEach((input) => {
            const field = input.getAttribute('data-bar-field');
            if (!field) return;
            barPayload[field] = input.value;
          });

          const openHoursByDay = new Map();
          screenElement.querySelectorAll('[data-open-hours-day][data-open-hours-field]').forEach((input) => {
            const day = input.getAttribute('data-open-hours-day');
            const field = input.getAttribute('data-open-hours-field');
            if (!day || !field) return;
            if (!openHoursByDay.has(day)) {
              openHoursByDay.set(day, { day_of_week: day });
            }
            openHoursByDay.get(day)[field] = input.value;
          });
          await saveBarUpdates(barPayload, [...openHoursByDay.values()]);
        }
      });
    });
  }

  function bindToolButtons() {
    screenElement.querySelectorAll('[data-tool]').forEach((button) => {
      button.addEventListener('click', async () => {
        const tool = button.getAttribute('data-tool');
        if (tool === 'specials-to-be-approved') {
          state.currentView = 'specials';
          render();
          await loadUnapprovedSpecials();
        }

        if (tool === 'special-management') {
          state.currentView = 'special-management';
          render();
          await loadAllBars();
          await loadAllSpecials();
        }

        if (tool === 'bar-management') {
          state.currentView = 'bar-management';
          render();
          await loadAllBars();
        }

        if (tool === 'rejected-special-management') {
          state.currentView = 'rejected-special-management';
          render();
          await loadRejectedSpecials();
        }
      });
    });
  }

  function renderHomeView() {
    titleElement.textContent = 'Admin';
    screenElement.innerHTML = `
      <section class="admin-home-view" aria-label="Admin tools">
        <h2>Admin tools</h2>
        <button type="button" class="admin-tool-button" data-tool="special-management">Special Management</button>
        <button type="button" class="admin-tool-button" data-tool="rejected-special-management">Rejected Specials</button>
        <button type="button" class="admin-tool-button" data-tool="bar-management">Bar Management</button>
        <button type="button" class="admin-tool-button" data-tool="specials-to-be-approved">Specials Pending Approval</button>
      </section>
    `;
    bindToolButtons();
  }

  function renderSpecialsView() {
    titleElement.textContent = 'Special Approvals';

    if (state.loading) {
      screenElement.innerHTML = '<p class="admin-loading">Loading unapproved specials...</p>';
      return;
    }

    screenElement.innerHTML = `
      <section class="admin-specials-view" aria-label="Special approvals">
        <h2>Specials Pending Approval</h2>
        <p class="admin-meta"><strong>Remaining NOT_APPROVED:</strong> ${state.pendingApprovalCount}</p>
        ${state.errorMessage ? `<p class="admin-error">${state.errorMessage}</p>` : ''}
        ${buildRunsMarkup()}
      </section>
      ${getRunDeleteConfirmationModalMarkup()}
    `;

    bindApprovalButtons();
  }

  function renderSpecialManagementView() {
    titleElement.textContent = 'Special Management';

    if (state.loadingSpecials) {
      screenElement.innerHTML = '<p class="admin-loading">Loading specials...</p>';
      return;
    }

    const neighborhoodOptions = [...new Set(state.allBars
      .map((row) => String(row.neighborhood || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const typeOptions = [...new Set(state.groupedSpecials
      .map((row) => String(row.type || '').trim().toLowerCase())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    screenElement.innerHTML = `
      <section class="admin-specials-view" aria-label="Special management">
        <h2>Special Management</h2>
        <input
          type="search"
          class="admin-input admin-special-search-input"
          data-special-search-input
          placeholder="Search by bar or neighborhood"
          value="${escapeAttribute(state.specialSearchTerm)}"
          aria-label="Search specials by bar or neighborhood"
        />
        <div class="admin-special-filters" aria-label="Special filters">
          <select class="admin-input admin-special-filter-select" data-special-filter="active" aria-label="Filter by active">
            <option value="all" ${state.specialFilterActive === 'all' ? 'selected' : ''}>Active: All</option>
            <option value="Y" ${state.specialFilterActive === 'Y' ? 'selected' : ''}>Active: Yes</option>
            <option value="N" ${state.specialFilterActive === 'N' ? 'selected' : ''}>Active: No</option>
          </select>
          <select class="admin-input admin-special-filter-select" data-special-filter="neighborhood" aria-label="Filter by neighborhood">
            <option value="all" ${state.specialFilterNeighborhood === 'all' ? 'selected' : ''}>Neighborhood: All</option>
            ${neighborhoodOptions.map((name) => `<option value="${escapeAttribute(name)}" ${state.specialFilterNeighborhood === name ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
          <select class="admin-input admin-special-filter-select" data-special-filter="type" aria-label="Filter by type">
            <option value="all" ${state.specialFilterType === 'all' ? 'selected' : ''}>Type: All</option>
            ${typeOptions.map((type) => `<option value="${escapeAttribute(type)}" ${state.specialFilterType === type ? 'selected' : ''}>Type: ${type}</option>`).join('')}
          </select>
          <select class="admin-input admin-special-filter-select" data-special-filter="all-day" aria-label="Filter by all day">
            <option value="all" ${state.specialFilterAllDay === 'all' ? 'selected' : ''}>All Day: All</option>
            <option value="Y" ${state.specialFilterAllDay === 'Y' ? 'selected' : ''}>All Day: Yes</option>
            <option value="N" ${state.specialFilterAllDay === 'N' ? 'selected' : ''}>All Day: No</option>
          </select>
        </div>
        <button type="button" class="admin-tool-button" data-special-create-toggle>Add New Special</button>
        ${state.errorMessage ? `<p class="admin-error">${state.errorMessage}</p>` : ''}
        ${buildSpecialManagementTable()}
        ${getCreateSpecialModalMarkup()}
      </section>
    `;

    bindSpecialManagementEvents();
  }

  function renderBarManagementView() {
    titleElement.textContent = 'Bar Management';

    if (state.loadingBars) {
      screenElement.innerHTML = '<p class="admin-loading">Loading bars...</p>';
      return;
    }

    screenElement.innerHTML = `
      <section class="admin-specials-view" aria-label="Bar management">
        <h2>Bar Management</h2>
        <input
          type="search"
          class="admin-input admin-special-search-input"
          data-bar-search-input
          placeholder="Search by bar or neighborhood"
          value="${escapeAttribute(state.barSearchTerm)}"
          aria-label="Search bars by bar or neighborhood"
        />
        ${state.generatingBarId ? `<p class="admin-loading">Generating candidate specials... ${state.generatingBarSecondsElapsed}s elapsed.</p>` : ''}
        ${getGenerateResultMarkup()}
        ${state.errorMessage ? `<p class="admin-error">${state.errorMessage}</p>` : ''}
        ${buildBarManagementTable()}
      </section>
    `;

    bindBarManagementEvents();
  }

  function getGenerateResultMarkup() {
    if (!state.generateResultPayload || typeof state.generateResultPayload !== 'object') return '';

    const payload = state.generateResultPayload;
    const rows = [
      ['Neighborhood', payload.neighborhood || '—'],
      ['Processed Bars', payload.processed_bars ?? '—'],
      ['Candidates Found', payload.candidate_specials_found ?? '—'],
      ['Auto Approved', payload.auto_approved_specials ?? '—'],
      ['Auto Rejected', payload.auto_rejected_specials ?? '—'],
      ['Needs Approval', payload.needs_approval_specials ?? '—'],
      ['Matched', payload.matched_specials ?? '—'],
      ['Crawl Specials', payload.website_crawl_specials ?? '—'],
      ['Web AI Search Specials', payload.web_ai_search_specials ?? '—'],
      ['Runs Created', payload.candidate_runs_created ?? '—'],
      ['Runs Auto Published', payload.candidate_runs_auto_published ?? '—'],
      ['Data Audit Invoked', payload.data_audit_invoked ?? '—'],
      ['Data Audit Error', payload.data_audit_error || '—']
    ];

    return `
      <div class="admin-generate-result">
        <h3>Generate Candidate Specials Complete</h3>
        <div class="admin-generate-result-grid">
          ${rows.map(([label, value]) => `<p><strong>${label}:</strong> ${value}</p>`).join('')}
        </div>
      </div>
    `;
  }

  function renderRejectedSpecialManagementView() {
    titleElement.textContent = 'Rejected Specials';

    if (state.loadingRejectedSpecials) {
      screenElement.innerHTML = '<p class="admin-loading">Loading rejected specials...</p>';
      return;
    }

    screenElement.innerHTML = `
      <section class="admin-specials-view" aria-label="Rejected specials">
        <h2>Rejected Specials</h2>
        ${state.errorMessage ? `<p class="admin-error">${state.errorMessage}</p>` : ''}
        ${buildRejectedSpecialManagementTable()}
      </section>
    `;

    bindRejectedSpecialManagementEvents();
  }

  function buildRejectedSpecialManagementTable() {
    const searchTerm = String(state.specialSearchTerm || '').trim().toLowerCase();
    const filteredRows = state.rejectedSpecials.filter((row) => {
      const neighborhood = String(row.neighborhood || '').trim().toLowerCase();
      const barName = String(row.bar_name || '').trim().toLowerCase();
      if (!searchTerm) return true;
      return neighborhood.includes(searchTerm) || barName.includes(searchTerm);
    });

    if (!filteredRows.length) {
      if (searchTerm) return '<p class="admin-empty">No rejected specials match that bar or neighborhood.</p>';
      return '<p class="admin-empty">No rejected specials found.</p>';
    }

    const rows = sortRows(filteredRows, 'rejected-special-management', rejectedSortValue);

    return `
      <input
        type="search"
        class="admin-input admin-special-search-input"
        data-rejected-special-search-input
        placeholder="Search by bar or neighborhood"
        value="${escapeAttribute(state.specialSearchTerm)}"
        aria-label="Search rejected specials by bar or neighborhood"
      />
      <div class="admin-table-wrap">
        <table class="admin-special-table">
          <thead>
            <tr>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="neighborhood">Neighborhood${getSortIndicator('rejected-special-management', 'neighborhood')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="bar_name">Bar Name${getSortIndicator('rejected-special-management', 'bar_name')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="description">Description${getSortIndicator('rejected-special-management', 'description')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="days_of_week">Days of Week${getSortIndicator('rejected-special-management', 'days_of_week')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="all_day">All Day${getSortIndicator('rejected-special-management', 'all_day')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="start_time">Start Time${getSortIndicator('rejected-special-management', 'start_time')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="end_time">End Time${getSortIndicator('rejected-special-management', 'end_time')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="type">Type${getSortIndicator('rejected-special-management', 'type')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="fetch_method">Method${getSortIndicator('rejected-special-management', 'fetch_method')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="source">Source${getSortIndicator('rejected-special-management', 'source')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="linked_candidate_count">Linked Candidates${getSortIndicator('rejected-special-management', 'linked_candidate_count')}</th>
              <th class="admin-sortable-header" data-sort-table="rejected-special-management" data-sort-key="insert_date">Last Seen${getSortIndicator('rejected-special-management', 'insert_date')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="admin-special-row" data-rejected-special-row="${row.reject_id}">
                <td>${row.neighborhood || '—'}</td>
                <td>${row.bar_name || '—'}</td>
                <td>${row.description || '—'}</td>
                <td>${formatDayGroup(row.days_of_week || [])}</td>
                <td>${row.all_day || '—'}</td>
                <td>${formatTime(row.start_time)}</td>
                <td>${formatTime(row.end_time)}</td>
                <td>${row.type || '—'}</td>
                <td>${row.fetch_method || '—'}</td>
                <td>${getSourceMarkup(row.source)}</td>
                <td>${row.linked_candidate_count ?? 0}</td>
                <td>${formatDateTime(row.insert_date)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${getRejectedSpecialActionMenuMarkup()}
    `;
  }

  function getRejectedSpecialActionMenuMarkup() {
    if (!state.actionRejectedCandidateId) return '';
    const selectedRow = state.rejectedSpecials.find((row) => Number(row.reject_id) === Number(state.actionRejectedSpecialId));
    const linkedCandidates = Array.isArray(selectedRow?.linked_candidates) ? selectedRow.linked_candidates : [];
    return `
      <div class="admin-modal-backdrop" data-close-rejected-action-menu="true">
        <div class="admin-modal" role="dialog" aria-label="Rejected special actions">
          <h3>Rejected Special Actions</h3>
          <button
            type="button"
            class="admin-tool-button"
            data-rejected-special-action="remove-rejected-candidate"
            data-special-candidate-id="${state.actionRejectedCandidateId}"
          >
            Remove Rejected Special Candidate
          </button>
          <button
            type="button"
            class="admin-tool-button"
            data-rejected-special-action="view-details"
          >
            View Linked Candidates (${linkedCandidates.length})
          </button>
          ${state.showRejectedDetails ? getRejectedSpecialDetailsMarkup(selectedRow) : ''}
          <button type="button" class="admin-secondary-btn" data-close-rejected-action-menu="true">Close</button>
        </div>
      </div>
    `;
  }



  function getRejectedSpecialDetailsMarkup(selectedRow) {
    if (!selectedRow || !state.actionRejectedSpecialId) return '';
    const linkedCandidates = Array.isArray(selectedRow.linked_candidates) ? selectedRow.linked_candidates : [];
    if (!linkedCandidates.length) return '<p class="admin-empty">No linked candidates found.</p>';
    return `
      <div class="admin-table-wrap" style="max-height: 240px; margin-top: 0.75rem;">
        <table class="admin-special-table">
          <thead>
            <tr>
              <th>Candidate ID</th><th>Run ID</th><th>Status</th><th>Method</th><th>Source</th><th>Insert Date</th>
            </tr>
          </thead>
          <tbody>
            ${linkedCandidates.map((candidate) => `
              <tr>
                <td>${candidate.special_candidate_id || '—'}</td>
                <td>${candidate.run_id || '—'}</td>
                <td>${candidate.approval_status || '—'}</td>
                <td>${candidate.fetch_method || '—'}</td>
                <td>${getSourceMarkup(candidate.source)}</td>
                <td>${formatDateTime(candidate.insert_date)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function bindRejectedSpecialManagementEvents() {
    bindSortableColumnHeaders();

    const searchInput = screenElement.querySelector('[data-rejected-special-search-input]');
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        const { selectionStart, selectionEnd } = event.target;
        state.specialSearchTerm = event.target.value;
        render();
        const nextInput = screenElement.querySelector('[data-rejected-special-search-input]');
        if (nextInput) {
          nextInput.focus();
          if (
            typeof selectionStart === 'number'
            && typeof selectionEnd === 'number'
            && typeof nextInput.setSelectionRange === 'function'
          ) {
            nextInput.setSelectionRange(selectionStart, selectionEnd);
          }
        }
      });
    }

    screenElement.querySelectorAll('[data-rejected-special-row]').forEach((row) => {
      row.addEventListener('click', () => {
        const rejectId = Number(row.getAttribute('data-rejected-special-row'));
        if (!rejectId) return;
        const selectedRow = state.rejectedSpecials.find((item) => Number(item.reject_id) === rejectId);
        if (!selectedRow) return;
        state.actionRejectedSpecialId = rejectId;
        state.actionRejectedCandidateId = Number(selectedRow.special_candidate_id) || null;
        state.showRejectedDetails = false;
        render();
      });
    });

    screenElement.querySelectorAll('[data-close-rejected-action-menu="true"]').forEach((element) => {
      element.addEventListener('click', (event) => {
        if (event.currentTarget !== event.target) return;
        state.actionRejectedCandidateId = null;
        state.actionRejectedSpecialId = null;
        state.showRejectedDetails = false;
        render();
      });
    });

    screenElement.querySelectorAll('[data-rejected-special-action="remove-rejected-candidate"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const specialCandidateId = Number(button.getAttribute('data-special-candidate-id'));
        if (!specialCandidateId) return;
        state.actionRejectedCandidateId = null;
        state.actionRejectedSpecialId = null;
        state.showRejectedDetails = false;
        await removeRejectedSpecialCandidate(specialCandidateId);
      });
    });

    screenElement.querySelectorAll('[data-rejected-special-action="view-details"]').forEach((button) => {
      button.addEventListener('click', () => {
        state.showRejectedDetails = !state.showRejectedDetails;
        render();
      });
    });
  }

  function bindSortableColumnHeaders() {
    screenElement.querySelectorAll('[data-sort-table][data-sort-key]').forEach((headerCell) => {
      headerCell.addEventListener('click', () => {
        const tableName = headerCell.getAttribute('data-sort-table');
        const columnKey = headerCell.getAttribute('data-sort-key');
        if (!tableName || !columnKey) return;
        toggleSort(tableName, columnKey);
        render();
      });
    });
  }

  function render() {
    updateToolbarButtons();
    if (state.currentView === 'specials') {
      renderSpecialsView();
      return;
    }

    if (state.currentView === 'special-management') {
      renderSpecialManagementView();
      return;
    }

    if (state.currentView === 'bar-management') {
      renderBarManagementView();
      return;
    }

    if (state.currentView === 'rejected-special-management') {
      renderRejectedSpecialManagementView();
      return;
    }

    renderHomeView();
  }

  render();
}());
