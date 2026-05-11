function resolveSpecialId(special, bar) {
  if (special?.special_id !== undefined && special?.special_id !== null) return String(special.special_id);

  const barId = special?.bar_id ?? bar?.bar_id;
  if (!startupPayload?.specials || barId === undefined || barId === null) return null;

  const matched = Object.entries(startupPayload.specials).find(([, candidate]) => {
    if (String(candidate.bar_id) !== String(barId)) return false;
    return candidate.day === special?.day
      && candidate.description === special?.description
      && candidate.special_type === (special?.special_type || special?.type)
      && candidate.start_time === special?.start_time
      && candidate.end_time === special?.end_time
      && Boolean(candidate.all_day) === Boolean(special?.all_day);
  });

  return matched ? String(matched[0]) : null;
}

function showSpecialDetail(bar, special, { previousScreen = 'specials', returnTo = 'specials', dayLabel = '' } = {}) {
  const groupedSpecialIds = Array.isArray(special?.grouped_special_ids)
    ? special.grouped_special_ids
      .map((specialId) => String(specialId))
      .filter(Boolean)
    : [];
  const hasGroupedSpecials = groupedSpecialIds.length > 1;

  const specialId = resolveSpecialId(special, bar);
  const payloadSpecial = specialId ? startupPayload?.specials?.[specialId] : null;
  const selectedSpecial = hasGroupedSpecials
    ? {
      ...(payloadSpecial ? { special_id: specialId, ...payloadSpecial } : {}),
      ...special,
      grouped_special_ids: groupedSpecialIds
    }
    : (payloadSpecial
      ? { special_id: specialId, ...payloadSpecial }
      : special);

  const barId = selectedSpecial?.bar_id ?? bar?.bar_id;
  const payloadBar = barId !== undefined && barId !== null
    ? startupPayload?.bars?.[String(barId)]
    : null;
  const selectedBar = payloadBar
    ? { bar_id: Number(barId), ...payloadBar }
    : bar;

  if (!selectedSpecial || !selectedBar) return;

  previousScreenState = { type: previousScreen, bar: selectedBar, returnTo };

  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('bars-screen').style.display = 'none';
  document.getElementById('favorites-screen').style.display = 'none';
  const mapScreen = document.getElementById('map-screen');
  if (mapScreen) mapScreen.style.display = 'none';
  document.getElementById('detail-screen').style.display = 'none';
  document.getElementById('special-screen').style.display = 'flex';
  setScreenLayout(false);
  animateScreenIn('special-screen');

  const barImage = document.getElementById('special-bar-image');
  barImage.src = (selectedBar.image_url && selectedBar.image_url !== 'null') ? selectedBar.image_url : 'https://placehold.co/640x360?text=Bar';

  if (barImage.dataset.bound !== 'true') {
    barImage.dataset.bound = 'true';
    barImage.addEventListener('click', () => {
      if (!currentSpecialContext?.bar) return;
      showDetail(currentSpecialContext.bar, previousScreenState?.returnTo || 'specials');
    });
  }
  barImage.style.cursor = 'pointer';

  const specialCard = document.getElementById('special-card');
  specialCard.innerHTML = '';

  const specialHeader = document.createElement('div');
  specialHeader.className = 'special-card-header-row';

  const barName = document.createElement('div');
  barName.className = 'special-bar-name';
  barName.textContent = selectedBar.name;

  const cardFavoriteButton = createFavoriteButton(selectedBar, selectedSpecial, dayLabel || 'Day unavailable');

  specialHeader.appendChild(barName);
  specialHeader.appendChild(cardFavoriteButton);

  const specialMeta = document.createElement('div');
  specialMeta.className = 'special-meta';

  const specialDay = document.createElement('span');
  specialDay.className = 'special-day-badge';
  specialDay.textContent = dayLabel || 'Day unavailable';
  specialMeta.appendChild(specialDay);

  currentSpecialContext = { bar: selectedBar, special: selectedSpecial, dayLabel: dayLabel || 'Day unavailable' };

  const specialRow = buildSpecialItem(selectedSpecial, { neutralTimeBadgeStyle: true });

  specialCard.appendChild(specialHeader);
  specialCard.appendChild(specialMeta);
  specialCard.appendChild(specialRow);

  resetSpecialReportForm();
  updateSpecialFavoriteButton(isFavoriteSpecial(selectedBar, selectedSpecial, dayLabel || 'Day unavailable'));
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
      const scrollToReport = () => {
        const submitButton = reportForm.querySelector('.special-report-submit');
        const scrollTarget = submitButton || reportForm;
        if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
          scrollTarget.scrollIntoView({
            block: 'end',
            inline: 'nearest',
            behavior: 'smooth'
          });
        }
      };
      requestAnimationFrame(scrollToReport);
      setTimeout(scrollToReport, 260);
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
