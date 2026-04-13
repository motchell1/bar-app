const DB_ADMIN_SYNC_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/dbAdminSync';

(function initAdminPage() {
  const backButton = document.getElementById('admin-back-button');
  const homeButton = document.getElementById('admin-home-button');
  const titleElement = document.getElementById('admin-title');
  const screenElement = document.getElementById('admin-screen');
  if (!backButton || !homeButton || !titleElement || !screenElement) return;

  const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
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
    updatingCandidateId: null,
    actionSpecialId: null,
    detailSpecials: [],
    detailEditing: false,
    savingSpecial: false,
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
    return date.toLocaleString();
  }

  function formatTime(value) {
    if (!value) return '—';
    return String(value).slice(0, 5);
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

  function getDetailModalMarkup() {
    if (!state.detailSpecials.length) return '';
    const specials = [...state.detailSpecials].sort((a, b) => {
      const aIndex = DAY_ORDER.indexOf(normalizeDay(a.day_of_week));
      const bIndex = DAY_ORDER.indexOf(normalizeDay(b.day_of_week));
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });

    const renderValue = (special, key, fallback = '—') => {
      if (state.detailEditing && ['day_of_week', 'all_day', 'start_time', 'end_time', 'description', 'type', 'is_active'].includes(key)) {
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
                      <td>${candidate.source || '—'}</td>
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

  function buildRunsMarkup() {
    if (state.runs.length === 0) {
      return '<p class="admin-empty">No unapproved specials.</p>';
    }

    return state.runs.map((run) => {
      const specialsMarkup = (run.specials || []).map((special) => {
        const candidateId = Number(special.special_candidate_id);
        const isUpdating = state.updatingCandidateId === candidateId;
        const days = Array.isArray(special.days_of_week) ? special.days_of_week.join(', ') : '—';
        const confidence = special.confidence === null || special.confidence === undefined ? '—' : String(special.confidence);

        return `
          <article class="admin-candidate-card" data-candidate-id="${candidateId}">
            <h4>${special.description || 'No description'}</h4>
            <p><strong>Type:</strong> ${special.type || '—'}</p>
            <p><strong>Neighborhood:</strong> ${special.neighborhood || '—'}</p>
            <p><strong>Days:</strong> ${days}</p>
            <p><strong>Time:</strong> ${formatTime(special.start_time)} - ${formatTime(special.end_time)} (All day: ${special.all_day || 'N'})</p>
            <p><strong>Confidence:</strong> ${confidence}</p>
            <p><strong>Method:</strong> ${special.fetch_method || '—'}</p>
            <p><strong>Source:</strong> ${special.source || '—'}</p>
            <p><strong>Notes:</strong> ${special.notes || '—'}</p>
            <div class="admin-actions-row">
              <button class="admin-action-btn approve" type="button" data-action="APPROVED" data-candidate-id="${candidateId}" ${isUpdating ? 'disabled' : ''}>Approve</button>
              <button class="admin-action-btn reject" type="button" data-action="REJECTED" data-candidate-id="${candidateId}" ${isUpdating ? 'disabled' : ''}>Reject</button>
            </div>
          </article>
        `;
      }).join('');

      return `
        <section class="admin-run-card">
          <h3>Run ${run.run_id} — ${run.bar_name || 'Unknown bar'}</h3>
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
    if (!state.groupedSpecials.length) {
      return '<p class="admin-empty">No specials found.</p>';
    }

    const rows = state.groupedSpecials.map((row) => `
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

  function bindApprovalButtons() {
    screenElement.querySelectorAll('[data-action][data-candidate-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const candidateId = Number(button.getAttribute('data-candidate-id'));
        const action = button.getAttribute('data-action');
        if (!candidateId || !action) return;
        updateCandidateApproval(candidateId, action);
      });
    });
  }

  function bindSpecialManagementEvents() {
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
      });
    });
  }

  function renderHomeView() {
    titleElement.textContent = 'Admin';
    screenElement.innerHTML = `
      <section class="admin-home-view" aria-label="Admin tools">
        <h2>Admin tools</h2>
        <button type="button" class="admin-tool-button" data-tool="special-management">Special Management</button>
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

    screenElement.innerHTML = `
      <section class="admin-specials-view" aria-label="Special management">
        <h2>Special Management</h2>
        ${state.errorMessage ? `<p class="admin-error">${state.errorMessage}</p>` : ''}
        ${buildSpecialManagementTable()}
      </section>
    `;

    bindSpecialManagementEvents();
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

    renderHomeView();
  }

  render();
}());
