function showSpecialDetail(bar, special, { previousScreen = 'specials', returnTo = 'specials', dayLabel = '' } = {}) {
  previousScreenState = { type: previousScreen, bar, returnTo };

  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('bars-screen').style.display = 'none';
  document.getElementById('favorites-screen').style.display = 'none';
  document.getElementById('detail-screen').style.display = 'none';
  document.getElementById('special-screen').style.display = 'block';
  setScreenLayout(false);

  const barImage = document.getElementById('special-bar-image');
  barImage.src = (bar.image_url && bar.image_url !== 'null') ? bar.image_url : 'https://placehold.co/640x360?text=Bar';

  const specialCard = document.getElementById('special-card');
  specialCard.innerHTML = '';

  const specialHeader = document.createElement('div');
  specialHeader.className = 'special-card-header-row';

  const barName = document.createElement('div');
  barName.className = 'special-bar-name';
  barName.textContent = bar.name;

  const cardFavoriteButton = createFavoriteButton(bar, special, dayLabel || 'Day unavailable');

  specialHeader.appendChild(barName);
  specialHeader.appendChild(cardFavoriteButton);

  const specialMeta = document.createElement('div');
  specialMeta.className = 'special-meta';

  const specialDay = document.createElement('span');
  specialDay.className = 'special-day-badge';
  specialDay.textContent = dayLabel || 'Day unavailable';
  specialMeta.appendChild(specialDay);

  currentSpecialContext = { bar, special, dayLabel: dayLabel || 'Day unavailable' };

  const specialRow = buildSpecialItem(special);

  specialCard.appendChild(specialHeader);
  specialCard.appendChild(specialMeta);
  specialCard.appendChild(specialRow);

  resetSpecialReportForm();
  updateSpecialFavoriteButton(isFavoriteSpecial(bar, special, dayLabel || 'Day unavailable'));
  lucide.createIcons();
}

function showPreviousScreen() {
  const previousType = previousScreenState?.type || 'specials';

  if (previousType === 'detail') {
    showDetail(previousScreenState.bar, previousScreenState.returnTo || 'specials');
    return;
  }
  resetSpecialReportForm();
  document.getElementById('special-screen').style.display = 'none';
  document.getElementById('detail-screen').style.display = 'none';
  showTab(previousType);
  setScreenLayout(true);
}

function resetSpecialReportForm() {
  const form = document.getElementById('special-report-form');
  const reasonSelect = document.getElementById('special-report-reason');
  const commentInput = document.getElementById('special-report-comment');
  const reportButton = document.getElementById('special-report-toggle');
  if (!form || !reasonSelect) return;

  if (reportButton) {
    reportButton.textContent = 'Mark for review';
    reportButton.disabled = false;
    reportButton.classList.remove('reported');
  }

  form.classList.remove('open');
  reasonSelect.value = '';
  if (commentInput) commentInput.value = '';
}

function initSpecialReport() {
  const toggleButton = document.getElementById('special-report-toggle');
  const reportForm = document.getElementById('special-report-form');

  if (!toggleButton || !reportForm) return;

  toggleButton.addEventListener('click', () => {
    const isOpen = reportForm.classList.contains('open');
    reportForm.classList.toggle('open', !isOpen);
    if (!isOpen) {
      requestAnimationFrame(() => {
        const submitButton = reportForm.querySelector('.special-report-submit');
        const scrollTarget = submitButton || reportForm;
        if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
          scrollTarget.scrollIntoView({ block: 'nearest' });
        }
      });
    }
  });
}

function showReportSuccess() {
  const reportButton = document.getElementById('special-report-toggle');
  if (reportButton) {
    reportButton.textContent = 'Thanks for your feedback!';
    reportButton.disabled = true;
    reportButton.classList.add('reported');
  }
}
