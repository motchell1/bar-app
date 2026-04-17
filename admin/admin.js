const DB_ADMIN_SYNC_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/dbAdminSync';

(function initAdminPage() {
  const backButton = document.getElementById('admin-back-button');
  const homeButton = document.getElementById('admin-home-button');
  const titleElement = document.getElementById('admin-title');
  const screenElement = document.getElementById('admin-screen');
  if (!backButton || !homeButton || !titleElement || !screenElement) return;

  const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
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
    loadingBars: false,
    specialSearchTerm: '',
    specialFilterActive: 'all',
    specialFilterNeighborhood: 'all',
    specialFilterType: 'all',
    specialFilterAllDay: 'all',
    updatingCandidateId: null,
    editingCandidateId: null,
    savingCandidate: false,
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
    runs: [],
    allSpecials: [],
    groupedSpecials: [],
    errorMessage: ''
  };

  function updateToolbarButtons() {
    const isHomeView = state.currentView === 'home';
    backButton.classList.toggle('is-hidden', isHomeView);
  }

  backButton.addEventListener('click', () => {
    if (state.currentView === 'home') return;
    state.currentView = 'home';
    state.errorMessage = '';
    state.actionSpecialId = null;
    state.detailSpecials = [];
    state.detailEditing = false;
    state.actionBarId = null;
    state.detailBar = null;
    state.detailOpenHours = [];
    state.detailBarEditing = false;
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

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return ADMIN_DATETIME_FORMATTER.format(date);
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
          daySet: new Set(),
          specials: []
        });
      }

      const row = grouped.get(key);
      row.specials.push(special);
      row.daySet.add(normalizeDay(special.day_of_week));

      const rowInsert = new Date(row.insert_date || 0).getTime();
      const specialInsert = new Date(special.insert_date || 0).getTime();
      if (!row.insert_date || specialInsert < rowInsert) {
        row.insert_date = special.insert_date;
      }

      const rowUpdate = new Date(row.update_date || 0).getTime();
      const specialUpdate = new Date(special.update_date || 0).getTime();
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
        const dateA = new Date(a.insert_date || 0).getTime();
        const dateB = new Date(b.insert_date || 0).getTime();
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
    } catch (err) {
      console.error('Failed to load unapproved specials:', err);
      state.errorMessage = err?.message || 'Failed to load unapproved specials.';
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
          <button type="button" class="admin-secondary-btn" data-close-action-menu="true">Close</button>
        </div>
      </div>
    `;
  }

  function getBarActionMenuMarkup() {
    if (!state.actionBarId) return '';
    return `
      <div class="admin-modal-backdrop" data-close-bar-action-menu="true">
        <div class="admin-modal" role="dialog" aria-label="Bar actions">
          <h3>Bar Actions</h3>
          <button type="button" class="admin-tool-button" data-bar-action="view-details" data-bar-id="${state.actionBarId}">View Details</button>
          <button type="button" class="admin-tool-button" data-bar-action="activate" data-bar-id="${state.actionBarId}">Activate Bar</button>
          <button type="button" class="admin-tool-button" data-bar-action="deactivate" data-bar-id="${state.actionBarId}">Deactivate Bar</button>
          <button type="button" class="admin-secondary-btn" data-close-bar-action-menu="true">Close</button>
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

    const detailsMarkup = specials.map((special) => {
      return `
        <section class="admin-special-detail-card">
          <h4>${DAY_LABELS[normalizeDay(special.day_of_week)] || special.day_of_week || 'Unknown Day'} — Special ${special.special_id}</h4>
          <div class="admin-detail-grid">
            <p><strong>Special ID:</strong> ${special.special_id ?? '—'}</p>
            <p><strong>Neighborhood:</strong> ${special.neighborhood || '—'}</p>
            <p><strong>Bar Name:</strong> ${special.bar_name || '—'}</p>
            <p><strong>Description:</strong> ${renderValue(special, 'description')}</p>
            <p><strong>Day of Week:</strong> ${renderValue(special, 'day_of_week')}</p>
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
      const specialsMarkup = (run.specials || []).map((special) => {
        const candidateId = Number(special.special_candidate_id);
        const isUpdating = state.updatingCandidateId === candidateId;
        const isEditing = state.editingCandidateId === candidateId;
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
                ? value.map((day) => normalizeDay(day))
                : String(value || '')
                  .split(',')
                  .map((day) => normalizeDay(day))
                  .filter(Boolean);
              return `
                <span>
                  ${DAY_ORDER.map((day) => `
                    <label>
                      <input
                        type="checkbox"
                        data-candidate-id="${candidateId}"
                        data-candidate-day="${day}"
                        ${selectedDays.includes(day) ? 'checked' : ''}
                      />
                      ${day.charAt(0) + day.slice(1).toLowerCase()}
                    </label>
                  `).join(' ')}
                </span>
              `;
            }
            return `<input class="admin-input" data-candidate-id="${candidateId}" data-candidate-field="${field}" value="${value}" />`;
          }
          if (field === 'days_of_week') {
            const resolvedDays = Array.isArray(value)
              ? value
              : String(value || '')
                .split(',')
                .map((day) => normalizeDay(day))
                .filter(Boolean);
            const displayDays = resolvedDays.map((day) => day.charAt(0) + day.slice(1).toLowerCase()).join(', ');
            return displayDays || fallback;
          }
          return value === '' ? fallback : String(value);
        };

        return `
          <article class="admin-candidate-card" data-candidate-id="${candidateId}">
            ${isEditing ? '' : `
              <button class="admin-icon-btn" type="button" aria-label="Edit special candidate" title="Edit" data-candidate-action="edit" data-candidate-id="${candidateId}" ${isUpdating ? 'disabled' : ''}>
                &#8943;
              </button>
            `}
            <h4>${isEditing ? 'Editing Special Candidate' : (special.description || 'No description')}</h4>
            <p><strong>Special Candidate ID:</strong> ${special.special_candidate_id ?? '—'}</p>
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
            <div class="admin-actions-row">
              ${isEditing
                ? `<button class="admin-action-btn approve" type="button" data-candidate-action="save-edit" data-candidate-id="${candidateId}" ${state.savingCandidate ? 'disabled' : ''}>Save</button>
                   <button class="admin-secondary-btn" type="button" data-candidate-action="cancel-edit" data-candidate-id="${candidateId}" ${state.savingCandidate ? 'disabled' : ''}>Cancel</button>`
                : `<button class="admin-action-btn approve" type="button" data-action="APPROVED" data-candidate-id="${candidateId}" ${isUpdating ? 'disabled' : ''}>Approve</button>
                   <button class="admin-action-btn reject" type="button" data-action="REJECTED" data-candidate-id="${candidateId}" ${isUpdating ? 'disabled' : ''}>Reject</button>`}
            </div>
          </article>
        `;
      }).join('');

      return `
        <section class="admin-run-card">
          <h3>Run ${run.run_id} — ${run.bar_name || 'Unknown bar'}</h3>
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

    const rows = filteredSpecials.map((row) => `
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
        <td>${formatDateTime(row.insert_date)}</td>
        <td>${formatDateTime(row.update_date)}</td>
      </tr>
    `).join('');

    return `
      <div class="admin-table-wrap">
        <table class="admin-special-table">
          <thead>
            <tr>
              <th>Neighborhood</th>
              <th>Bar Name</th>
              <th>Description</th>
              <th>Days of Week</th>
              <th>All Day</th>
              <th>Start Time</th>
              <th>End Time</th>
              <th>Type</th>
              <th>Is Active</th>
              <th>Insert Method</th>
              <th>Insert Date</th>
              <th>Update Date</th>
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
    if (!state.allBars.length) {
      return '<p class="admin-empty">No bars found.</p>';
    }

    const rows = state.allBars.map((bar) => `
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
              <th>Name</th>
              <th>Neighborhood</th>
              <th>Is Active</th>
              <th>Last Candidate Run</th>
              <th>Insert Date</th>
              <th>Update Date</th>
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
  }

  function bindSpecialManagementEvents() {
    const searchInput = screenElement.querySelector('[data-special-search-input]');
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        state.specialSearchTerm = event.target.value;
        render();
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
          await saveSpecialUpdates([...payloadBySpecialId.values()]);
        }
      });
    });
  }

  function bindBarManagementEvents() {
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
          await loadAllSpecials();
        }

        if (tool === 'bar-management') {
          state.currentView = 'bar-management';
          render();
          await loadAllBars();
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
        ${state.errorMessage ? `<p class="admin-error">${state.errorMessage}</p>` : ''}
        ${buildRunsMarkup()}
      </section>
    `;

    bindApprovalButtons();
  }

  function renderSpecialManagementView() {
    titleElement.textContent = 'Special Management';

    if (state.loadingSpecials) {
      screenElement.innerHTML = '<p class="admin-loading">Loading specials...</p>';
      return;
    }

    const neighborhoodOptions = [...new Set(state.groupedSpecials
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
        ${state.errorMessage ? `<p class="admin-error">${state.errorMessage}</p>` : ''}
        ${buildSpecialManagementTable()}
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
        ${state.errorMessage ? `<p class="admin-error">${state.errorMessage}</p>` : ''}
        ${buildBarManagementTable()}
      </section>
    `;

    bindBarManagementEvents();
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

    renderHomeView();
  }

  render();
}());
