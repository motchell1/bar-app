function getDayKeyFromName(dayName) {
  const dayIndex = DAYS_FULL.findIndex((name) => name === dayName);
  if (dayIndex < 0) return '';
  return DAYS_FULL[dayIndex].slice(0, 3).toUpperCase();
}

function getOrderedDaysForDetail(todayKey) {
  const todayIndex = DAYS_FULL.findIndex((day) => day.slice(0, 3).toUpperCase() === todayKey);
  if (todayIndex < 0) return DAYS_FULL.slice();
  return DAYS_FULL.slice(todayIndex).concat(DAYS_FULL.slice(0, todayIndex));
}

function getBarFromPayload(barOrId) {
  const barId = String(typeof barOrId === 'object' ? barOrId?.bar_id : barOrId);
  const barData = startupPayload?.bars?.[barId];
  if (!barData) return null;

  return {
    bar_id: Number(barId),
    ...barData
  };
}

function buildBarDetailPayloadFromStartup(barId) {
  const normalizedBarId = String(barId);
  const barData = startupPayload?.bars?.[normalizedBarId];
  if (!barData || barData.has_special_this_week !== true) {
    return null;
  }

  const generalData = startupPayload?.general_data || {};
  const startupSpecials = startupPayload?.specials || {};
  const startupSpecialsByDay = startupPayload?.specials_by_day || {};
  const detailSpecials = {};
  const detailSpecialsByDay = {};

  Object.entries(startupSpecialsByDay).forEach(([dayKey, entries]) => {
    const barEntry = (entries || []).find((entry) => String(entry.bar_id) === normalizedBarId);
    const specialIds = barEntry?.specials || [];
    detailSpecialsByDay[dayKey] = specialIds.map(String);

    specialIds.forEach((specialId) => {
      const special = startupSpecials[String(specialId)];
      if (!special) return;
      detailSpecials[String(specialId)] = special;
    });
  });

  return {
    bar: {
      bar_id: Number(normalizedBarId),
      name: barData.name,
      neighborhood: barData.neighborhood,
      image_url: barData.image_url
    },
    general_data: generalData,
    open_hours: startupPayload?.open_hours?.[normalizedBarId] || {},
    specials: detailSpecials,
    specials_by_day: detailSpecialsByDay
  };
}

function resetBarReportForm() {
  const form = document.getElementById('bar-report-form');
  const reasonSelect = document.getElementById('bar-report-reason');
  const commentInput = document.getElementById('bar-report-comment');
  const reportButton = document.getElementById('bar-report-toggle');
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

function initBarReport() {
  const toggleButton = document.getElementById('bar-report-toggle');
  const reportForm = document.getElementById('bar-report-form');

  if (!toggleButton || !reportForm) return;
  if (toggleButton.dataset.bound === 'true') return;
  toggleButton.dataset.bound = 'true';

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

function showBarReportSuccess() {
  const reportButton = document.getElementById('bar-report-toggle');
  if (reportButton) {
    reportButton.textContent = 'Thanks for your feedback!';
    reportButton.disabled = true;
    reportButton.classList.add('reported');
  }
}

function updateBarFavoriteButton(isFavorited) {
  const button = document.getElementById('detail-favorite-button');
  if (!button) return;
  button.classList.toggle('active', isFavorited);
  button.setAttribute('aria-pressed', isFavorited ? 'true' : 'false');
}

function initBarFavoriteButton() {
  const button = document.getElementById('detail-favorite-button');
  if (!button || button.dataset.bound === 'true') return;
  button.dataset.bound = 'true';

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!currentBarContext) return;
    const nowFavorited = toggleFavoriteBar(currentBarContext);
    updateBarFavoriteButton(nowFavorited);
    if (currentTab === 'specials' || currentTab === 'favorites') {
      renderCurrentTabData();
    }
    lucide.createIcons();
  });
}


function updateBarLocationSection(selectedBar) {
  const section = document.getElementById('detail-location-section');
  const mapFrame = document.getElementById('detail-location-map');
  if (!section || !mapFrame) return;

  const placeId = selectedBar?.google_place_id;
  const googleApiKey = startupPayload?.general_data?.google_api_key;
  if (!placeId || !googleApiKey) {
    section.style.display = 'none';
    mapFrame.removeAttribute('src');
    return;
  }

  const encodedPlaceQuery = encodeURIComponent(`place_id:${placeId}`);
  const encodedApiKey = encodeURIComponent(googleApiKey);
  mapFrame.setAttribute('src', `https://www.google.com/maps/embed/v1/place?key=${encodedApiKey}&q=${encodedPlaceQuery}`);
  section.style.display = '';
}

function normalizeWebsiteUrl(websiteValue) {
  const rawValue = String(websiteValue || '').trim();
  if (!rawValue) return '';
  if (/^https?:\/\//i.test(rawValue)) return rawValue;
  return `https://${rawValue}`;
}

function updateBarWebsiteSection(selectedBar) {
  const section = document.getElementById('detail-website-section');
  const link = document.getElementById('detail-website-link');
  if (!section || !link) return;

  const normalizedUrl = normalizeWebsiteUrl(selectedBar?.website_url || selectedBar?.website || '');
  if (!normalizedUrl) {
    section.style.display = 'none';
    link.textContent = '';
    link.removeAttribute('href');
    return;
  }

  section.style.display = '';
  link.setAttribute('href', normalizedUrl);
  link.textContent = normalizedUrl;
}

function renderBarDetailContent(selectedBar, detailPayload) {
  const todayKey = detailPayload?.general_data?.current_day || startupPayload?.general_data?.current_day || getDayKeyFromName(DAYS_FULL[new Date().getDay()]);
  const orderedDays = getOrderedDaysForDetail(todayKey);
  const openHoursForBar = detailPayload?.open_hours || {};

  const hoursEl = document.getElementById('detail-hours');
  const hoursEmptyEl = document.getElementById('detail-hours-empty');
  hoursEl.innerHTML = '';

  const hasAnyHours = orderedDays.some((day) => {
    const dayKey = getDayKeyFromName(day);
    return Boolean(openHoursForBar[dayKey]?.display_text);
  });

  if (hasAnyHours) {
    hoursEl.style.display = '';
    hoursEmptyEl.style.display = 'none';

    orderedDays.forEach((day) => {
      const dayKey = getDayKeyFromName(day);
      const hours = openHoursForBar[dayKey] || null;

      const row = document.createElement('tr');
      if (dayKey === todayKey) row.classList.add('today');

      const dayCell = document.createElement('td');
      dayCell.textContent = day;

      const hoursCell = document.createElement('td');
      hoursCell.textContent = hours?.display_text || '';

      row.appendChild(dayCell);
      row.appendChild(hoursCell);
      hoursEl.appendChild(row);
    });
  } else {
    hoursEl.style.display = 'none';
    hoursEmptyEl.style.display = 'block';
    hoursEmptyEl.textContent = 'No open hours found';
  }

  const specialsContainer = document.getElementById('detail-specials');
  specialsContainer.innerHTML = '';

  orderedDays.forEach((day) => {
    const dayKey = getDayKeyFromName(day);
    const specialIds = detailPayload?.specials_by_day?.[dayKey] || [];

    const wrapper = document.createElement('div');
    wrapper.className = 'day-group';

    const header = document.createElement('div');
    header.className = 'day-header';
    if (dayKey === todayKey) header.classList.add('today');

    const label = document.createElement('span');
    label.textContent = dayKey === todayKey ? `${day} (Today)` : day;

    const arrow = document.createElement('span');
    arrow.className = 'arrow rotate';
    arrow.textContent = '▶';

    header.appendChild(label);
    header.appendChild(arrow);

    const content = document.createElement('div');
    content.className = 'day-content expanded';

    if (specialIds.length > 0) {
      const specialsForDay = specialIds
        .map((specialId) => {
          const specialData = detailPayload?.specials?.[String(specialId)];
          if (!specialData) return null;
          return {
            special_id: String(specialId),
            ...specialData
          };
        })
        .filter(Boolean);

      const groupedSpecials = groupSpecialsForUI(specialsForDay);

      groupedSpecials.forEach((special) => {
        const div = buildSpecialItem(special, {
          neutralTimeBadgeStyle: true,
          clickable: true,
          onClick: () => showSpecialDetail(selectedBar, special, {
            previousScreen: 'detail',
            returnTo: previousScreenState?.type || currentTab,
            dayLabel: dayKey === todayKey ? `${day} (Today)` : day
          })
        });
        content.appendChild(div);
      });
    }

    if (content.children.length === 0) {
      const noSpecials = document.createElement('div');
      noSpecials.className = 'special-item no-specials-item';

      const desc = document.createElement('span');
      desc.className = 'special-description';
      desc.textContent = 'No specials today.';

      noSpecials.appendChild(desc);
      content.appendChild(noSpecials);
    }

    wrapper.appendChild(header);
    wrapper.appendChild(content);
    specialsContainer.appendChild(wrapper);

    requestAnimationFrame(() => {
      content.style.maxHeight = `${content.scrollHeight}px`;
      lucide.createIcons();
    });

    header.onclick = () => {
      const isOpen = content.style.maxHeight && content.style.maxHeight !== '0px';
      if (isOpen) {
        content.style.maxHeight = '0px';
        content.classList.remove('expanded');
        arrow.classList.remove('rotate');
      } else {
        content.style.maxHeight = `${content.scrollHeight}px`;
        content.classList.add('expanded');
        arrow.classList.add('rotate');
      }
    };
  });
}

async function showDetail(barOrId, previousScreen = currentTab) {
  const selectedBar = getBarFromPayload(barOrId) || (typeof barOrId === 'object' ? barOrId : null);
  if (!selectedBar) return;

  previousScreenState = { type: previousScreen };
  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('bars-screen').style.display = 'none';
  document.getElementById('favorites-screen').style.display = 'none';
  const mapScreen = document.getElementById('map-screen');
  if (mapScreen) mapScreen.style.display = 'none';
  document.getElementById('special-screen').style.display = 'none';
  document.getElementById('detail-screen').style.display = 'flex';
  setScreenLayout(false);
  animateScreenIn('detail-screen');

  document.getElementById('detail-image').src = selectedBar.image_url || '';
  document.getElementById('detail-name').textContent = (selectedBar.name || '').toUpperCase();
  initBarFavoriteButton();
  updateBarFavoriteButton(isFavoriteBar(selectedBar));
  initBarReport();
  currentBarContext = selectedBar;
  resetBarReportForm();
  updateBarLocationSection(selectedBar);
  updateBarWebsiteSection(selectedBar);

  const startupDetailPayload = buildBarDetailPayloadFromStartup(selectedBar.bar_id);
  if (startupDetailPayload) {
    renderBarDetailContent(selectedBar, startupDetailPayload);
    return;
  }

  const hoursEl = document.getElementById('detail-hours');
  const hoursEmptyEl = document.getElementById('detail-hours-empty');
  const specialsContainer = document.getElementById('detail-specials');

  hoursEl.innerHTML = '';
  hoursEl.style.display = 'none';
  hoursEmptyEl.style.display = 'block';
  hoursEmptyEl.textContent = 'Loading open hours...';
  specialsContainer.innerHTML = '<div class="no-specials-line" style="padding:12px;">Loading specials...</div>';

  try {
    const detailPayload = await loadBarDetails(selectedBar.bar_id);
    if (!detailPayload) {
      hoursEmptyEl.textContent = 'No open hours found';
      specialsContainer.innerHTML = '<div class="no-specials-line" style="padding:12px;">Unable to load bar details.</div>';
      return;
    }

    updateBarWebsiteSection({
      ...selectedBar,
      website_url: detailPayload?.bar?.website_url || selectedBar?.website_url
    });
    renderBarDetailContent(selectedBar, detailPayload);
  } catch (err) {
    console.error('Failed to load bar details:', err);
    hoursEmptyEl.textContent = 'No open hours found';
    specialsContainer.innerHTML = '<div class="no-specials-line" style="padding:12px;">Unable to load bar details.</div>';
  }
}
