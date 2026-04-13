const DB_ADMIN_SYNC_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/dbAdminSync';

(function initAdminPage() {
  const backButton = document.getElementById('admin-back-button');
  const homeButton = document.getElementById('admin-home-button');
  const titleElement = document.getElementById('admin-title');
  const screenElement = document.getElementById('admin-screen');
  if (!backButton || !homeButton || !titleElement || !screenElement) return;

  const state = {
    currentView: 'home',
    loading: false,
    updatingCandidateId: null,
    runs: [],
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
          <p><strong>Web Crawl:</strong></p>
          <ul class="admin-run-sublist">
            <li><strong>AI Parse Attempted:</strong> ${run.web_crawl_ai_parse_attempted ?? '—'}</li>
            <li><strong>Candidates:</strong> ${run.web_crawl_candidates ?? '—'}</li>
            <li><strong>Candidate Links:</strong> ${run.web_crawl_candidate_links ?? '—'}</li>
            <li><strong>Keyword Matches:</strong> ${run.web_crawl_keyword_matches ?? '—'}</li>
          </ul>
          <p><strong>Web AI Search:</strong></p>
          <ul class="admin-run-sublist">
            <li><strong>Attempted:</strong> ${run.web_ai_search_attempted ?? '—'}</li>
            <li><strong>Candidates:</strong> ${run.web_ai_search_candidates ?? '—'}</li>
          </ul>
          <p><strong>Started:</strong> ${formatDateTime(run.started_at)}</p>
          <p><strong>Completed:</strong> ${formatDateTime(run.completed_at)}</p>
          <div class="admin-candidate-list">${specialsMarkup}</div>
        </section>
      `;
    }).join('');
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

  function bindToolButtons() {
    screenElement.querySelectorAll('[data-tool]').forEach((button) => {
      button.addEventListener('click', async () => {
        const tool = button.getAttribute('data-tool');
        if (tool === 'specials-to-be-approved') {
          state.currentView = 'specials';
          render();
          await loadUnapprovedSpecials();
        }
      });
    });
  }

  function renderHomeView() {
    titleElement.textContent = 'Admin';
    screenElement.innerHTML = `
      <section class="admin-home-view" aria-label="Admin tools">
        <h2>Admin tools</h2>
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

  function render() {
    updateToolbarButtons();
    if (state.currentView === 'specials') {
      renderSpecialsView();
      return;
    }
    renderHomeView();
  }

  render();
}());
