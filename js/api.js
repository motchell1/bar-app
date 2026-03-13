const STARTUP_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/getStartupData';
const SPECIAL_REPORT_API_URL = 'https://3kz7x6tvvi.execute-api.us-east-2.amazonaws.com/default/insertUserReport';

async function loadBars() {
  try {
    const response = await fetch(STARTUP_API_URL);
    const data = await response.json();
    const parsed = typeof data.body === 'string' ? JSON.parse(data.body) : data;
    barsData = parsed.bars || [];
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
