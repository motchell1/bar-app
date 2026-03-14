const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class ClassList {
  constructor(element) {
    this.element = element;
  }
  _get() {
    return new Set((this.element.className || '').split(/\s+/).filter(Boolean));
  }
  _set(values) {
    this.element.className = [...values].join(' ');
  }
  add(...names) {
    const values = this._get();
    names.forEach((n) => values.add(n));
    this._set(values);
  }
  remove(...names) {
    const values = this._get();
    names.forEach((n) => values.delete(n));
    this._set(values);
  }
  toggle(name, force) {
    const values = this._get();
    if (force === true) {
      values.add(name);
      this._set(values);
      return true;
    }
    if (force === false) {
      values.delete(name);
      this._set(values);
      return false;
    }
    if (values.has(name)) {
      values.delete(name);
      this._set(values);
      return false;
    }
    values.add(name);
    this._set(values);
    return true;
  }
  contains(name) {
    return this._get().has(name);
  }
}

class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.eventListeners = {};
    this.className = '';
    this.classList = new ClassList(this);
    this.textContent = '';
    this._innerHTML = '';
    this.onclick = null;
    this.id = '';
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') {
      this.id = String(value);
      this.ownerDocument._idMap.set(this.id, this);
    }
  }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, cb) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(cb);
  }
  dispatchEvent(event) {
    const list = this.eventListeners[event.type] || [];
    list.forEach((cb) => cb(event));
  }
  click() {
    const event = { type: 'click', stopPropagation() {} };
    this.dispatchEvent(event);
    if (typeof this.onclick === 'function') this.onclick(event);
  }
  _matchesSimpleSelector(selector) {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).filter(Boolean).includes(selector.slice(1));
    }
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  _collectMatches(selector, results) {
    for (const child of this.children) {
      if (child._matchesSimpleSelector(selector)) results.push(child);
      child._collectMatches(selector, results);
    }
  }
  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all[0] || null;
  }
  querySelectorAll(selector) {
    const selectors = selector.trim().split(/\s+/);
    let current = [this];
    for (const sel of selectors) {
      const next = [];
      for (const node of current) {
        const matches = [];
        node._collectMatches(sel, matches);
        next.push(...matches);
      }
      current = next;
    }
    return current;
  }
}

class DocumentMock {
  constructor() {
    this._idMap = new Map();
    this.body = new Element('body', this);
  }
  createElement(tagName) { return new Element(tagName, this); }
  getElementById(id) { return this._idMap.get(id) || null; }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  addEventListener() {}
}

function loadAppWithoutBoot(document) {
  const scriptFiles = [
    'js/state.js',
    'js/utils.js',
    'js/render-home.js',
    'js/render-bar-detail.js',
    'js/render-favorites.js',
    'js/render-special-detail.js',
    'js/api.js',
    'js/app.js'
  ];
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  };

  const context = {
    console,
    document,
    window: { document, localStorage },
    localStorage,
    lucide: { createIcons() {} },
    fetch: async () => ({ json: async () => ({ bars: [] }) }),
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
  };
  vm.createContext(context);
  scriptFiles.forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const executable = file === 'js/app.js'
      ? source.split('// ===== Initialize =====')[0]
      : source;
    vm.runInContext(executable, context);
  });
  vm.runInContext('isInitialDataLoading = false;', context);
  return context;
}

function mountBaseNodes(document) {
  const favoritesScreen = document.createElement('div');
  favoritesScreen.setAttribute('id', 'favorites-screen');
  const favoritesList = document.createElement('div');
  favoritesList.setAttribute('id', 'favorites-list');
  favoritesScreen.appendChild(favoritesList);
  document.body.appendChild(favoritesScreen);

  const specialCard = document.createElement('div');
  specialCard.setAttribute('id', 'special-card');
  document.body.appendChild(specialCard);

  const specialBarImage = document.createElement('img');
  specialBarImage.setAttribute('id', 'special-bar-image');
  document.body.appendChild(specialBarImage);

  const home = document.createElement('div');
  home.setAttribute('id', 'home-screen');
  const homeBars = document.createElement('div');
  homeBars.setAttribute('id', 'home-bars');
  home.appendChild(homeBars);

  const bars = document.createElement('div');
  bars.setAttribute('id', 'bars-screen');
  const detail = document.createElement('div');
  detail.setAttribute('id', 'detail-screen');
  const special = document.createElement('div');
  special.setAttribute('id', 'special-screen');
  document.body.appendChild(home);
  document.body.appendChild(bars);
  document.body.appendChild(detail);
  document.body.appendChild(special);
}

function mountSpecialReportNodes(document) {
  const toggle = document.createElement('button');
  toggle.setAttribute('id', 'special-report-toggle');
  toggle.textContent = 'Mark for review';
  document.body.appendChild(toggle);

  const form = document.createElement('form');
  form.setAttribute('id', 'special-report-form');

  const reason = document.createElement('select');
  reason.setAttribute('id', 'special-report-reason');
  form.appendChild(reason);

  const comment = document.createElement('textarea');
  comment.setAttribute('id', 'special-report-comment');
  form.appendChild(comment);

  const submit = document.createElement('button');
  submit.className = 'special-report-submit';
  submit.textContent = 'Submit';
  form.appendChild(submit);

  document.body.appendChild(form);
}

test('initSpecialReport scrolls submit button into view when report form opens', async () => {
  const document = new DocumentMock();
  mountBaseNodes(document);
  mountSpecialReportNodes(document);
  const ctx = loadAppWithoutBoot(document);

  const submitButton = document.querySelector('.special-report-submit');
  let scrolled = false;
  submitButton.scrollIntoView = () => {
    scrolled = true;
  };

  document.getElementById('special-report-form').classList.remove('open');
  ctx.initSpecialReport();
  document.getElementById('special-report-toggle').click();

  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(document.getElementById('special-report-form').classList.contains('open'), true);
  assert.equal(scrolled, true, 'scrolls the submit button into view when opening');
});

test('favorites cards render star in header and omit neighborhood label', () => {
  const document = new DocumentMock();
  mountBaseNodes(document);
  const ctx = loadAppWithoutBoot(document);

  vm.runInContext(`
    startupPayload = {
      bars: { '1': { name: 'Test Bar', neighborhood: 'Downtown' } },
      open_hours: { '1': {} },
      specials: {
        '11': { bar_id: 1, description: '$5 Beer', special_type: 'drink', all_day: false, start_time: '16:00', end_time: '18:00', current_status: 'past', favorite: true, day: 'MON' }
      }
    };
    currentTab = 'favorites';
    activeFilters.types = [];
    activeFilters.neighborhoods = [];
  `, ctx);

  ctx.renderFavorites(ctx.getFavoriteSpecialEntries());

  const card = document.querySelector('.bar-card');
  assert.ok(card, 'renders a favorites card');
  assert.ok(card.querySelector('.special-card-header-row'), 'renders header row');
  assert.ok(card.querySelector('.special-favorite-button'), 'renders favorite button');
  assert.equal(card.querySelector('.bar-neighborhood'), null, 'does not render neighborhood label');

  const timeBadge = card.querySelector('.time-badge');
  assert.ok(timeBadge, 'renders time badge');
  assert.equal(timeBadge.classList.contains('past'), false, 'favorites uses neutral upcoming time badge style');
  const specialItem = card.querySelector('.special-item');
  assert.equal(specialItem.classList.contains('live'), false, 'favorites card should not render live styling');
});

test('clicking favorites star unfavorites and removes card from list', async () => {
  const document = new DocumentMock();
  mountBaseNodes(document);
  const ctx = loadAppWithoutBoot(document);

  vm.runInContext(`
    startupPayload = {
      bars: { '1': { name: 'Test Bar', neighborhood: 'Downtown' } },
      open_hours: { '1': {} },
      specials: {
        '11': {
          special_id: '11',
          bar_id: 1,
          description: '$5 Beer',
          special_type: 'drink',
          day: 'MON',
          all_day: false,
          start_time: '16:00',
          end_time: '18:00',
          favorite: true
        }
      }
    };
    currentTab = 'favorites';
    activeFilters.types = [];
    activeFilters.neighborhoods = [];
  `, ctx);

  ctx.renderFavorites(ctx.getFavoriteSpecialEntries());

  const favoriteButton = document.querySelector('.special-favorite-button');
  assert.ok(favoriteButton, 'favorite button exists before click');

  favoriteButton.click();

  await new Promise((resolve) => setTimeout(resolve, 760));

  const isFavorite = vm.runInContext("startupPayload.specials['11'].favorite", ctx);
  assert.equal(isFavorite, false, 'favorite flag updated in startup payload');

  const cards = document.querySelectorAll('.bar-card');
  assert.equal(cards.length, 0, 'favorite card removed after rerender');

  const emptyState = document.querySelector('.no-specials-line');
  assert.ok(emptyState, 'empty state shown after removing last favorite');
});

test('submitSpecialReport posts special report payload and resets form', async () => {
  const document = new DocumentMock();
  mountBaseNodes(document);
  mountSpecialReportNodes(document);

  const fetchCalls = [];
  const ctx = loadAppWithoutBoot(document);
  ctx.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return { json: async () => ({ ok: true }) };
  };

  const bar = { id: 12, name: 'Sample Bar' };
  const special = { special_id: 'sp-123', day: 'MON', start_time: '16:00', end_time: '18:00', description: 'Half off', type: 'drink', all_day: false };
  vm.runInContext(`currentSpecialContext = ${JSON.stringify({ bar, special, dayLabel: 'Monday' })};`, ctx);

  document.getElementById('special-report-reason').value = 'Special details are inaccurate';
  document.getElementById('special-report-comment').value = 'Menu says different price';

  await ctx.submitSpecialReport({ preventDefault() {} });

  assert.equal(fetchCalls.length, 1, 'calls fetch once');
  assert.equal(fetchCalls[0].url, 'https://3kz7x6tvvi.execute-api.us-east-2.amazonaws.com/default/insertUserReport');
  assert.equal(fetchCalls[0].options.method, 'POST');

  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.reason, 'Special details are inaccurate');
  assert.equal(body.comment, 'Menu says different price');
  assert.equal(typeof body.special_id, 'string');
  assert.equal(document.getElementById('special-report-form').classList.contains('open'), false, 'form is closed after submit');
  assert.equal(document.getElementById('special-report-reason').value, '', 'reason reset');
  assert.equal(document.getElementById('special-report-comment').value, '', 'comment reset');
  assert.equal(document.getElementById('special-report-toggle').textContent, 'Thanks for your feedback!', 'report button shows success state');
  assert.equal(document.getElementById('special-report-toggle').disabled, true, 'report button disabled after submit');
  assert.equal(document.getElementById('special-report-toggle').classList.contains('reported'), true, 'reported style applied');
});

test('resetSpecialReportForm clears success mode for the next special', () => {
  const document = new DocumentMock();
  mountBaseNodes(document);
  mountSpecialReportNodes(document);
  const ctx = loadAppWithoutBoot(document);

  const reportButton = document.getElementById('special-report-toggle');
  reportButton.textContent = 'Thanks for your feedback!';
  reportButton.disabled = true;
  reportButton.classList.add('reported');

  document.getElementById('special-report-form').classList.add('open');
  document.getElementById('special-report-reason').value = 'Other';
  document.getElementById('special-report-comment').value = 'Some comment';

  ctx.resetSpecialReportForm();

  assert.equal(reportButton.textContent, 'Mark for review');
  assert.equal(reportButton.disabled, false);
  assert.equal(reportButton.classList.contains('reported'), false);
  assert.equal(document.getElementById('special-report-form').classList.contains('open'), false);
  assert.equal(document.getElementById('special-report-reason').value, '');
  assert.equal(document.getElementById('special-report-comment').value, '');
});

test('submitSpecialReport sends null comment when left blank', async () => {
  const document = new DocumentMock();
  mountBaseNodes(document);
  mountSpecialReportNodes(document);

  const fetchCalls = [];
  const ctx = loadAppWithoutBoot(document);
  ctx.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return { json: async () => ({ ok: true }) };
  };

  const bar = { id: 12, name: 'Sample Bar' };
  const special = { special_id: 'sp-456', day: 'MON', start_time: '16:00', end_time: '18:00', description: 'Half off', type: 'drink', all_day: false };
  vm.runInContext(`currentSpecialContext = ${JSON.stringify({ bar, special, dayLabel: 'Monday' })};`, ctx);

  document.getElementById('special-report-reason').value = 'Other';
  document.getElementById('special-report-comment').value = '    ';

  await ctx.submitSpecialReport({ preventDefault() {} });

  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.comment, null);
});


test('renderBarsWeek shows today through next 6 days and open status only for today', () => {
  const document = new DocumentMock();
  mountBaseNodes(document);
  const ctx = loadAppWithoutBoot(document);

  vm.runInContext(`
    startupPayload = {
      general_data: { current_day: 'MON' },
      bars: {
        '1': { name: 'Today Bar', neighborhood: 'Downtown', image_url: null, currently_open: true },
        '2': { name: 'Tomorrow Bar', neighborhood: 'Midtown', image_url: null, currently_open: false }
      },
      open_hours: {
        '1': { MON: { display_text: '4:00 PM - 2:00 AM' } },
        '2': { TUE: { display_text: '5:00 PM - 1:00 AM' } }
      },
      specials: {
        '11': { bar_id: 1, description: '$5 Beer', special_type: 'drink', all_day: false, start_time: '16:00', end_time: '18:00', current_status: 'active' },
        '22': { bar_id: 2, description: '$4 Wells', special_type: 'drink', all_day: false, start_time: '17:00', end_time: '19:00', current_status: 'upcoming' }
      },
      specials_by_day: {
        MON: [{ bar_id: 1, specials: ['11'] }],
        TUE: [{ bar_id: 2, specials: ['22'] }],
        WED: [],
        THU: [],
        FRI: [],
        SAT: [],
        SUN: []
      }
    };
    currentTab = 'specials';
    activeFilters.types = [];
    activeFilters.neighborhoods = [];
  `, ctx);

  ctx.renderBarsWeek();

  const dayHeaders = document.querySelectorAll('.day-header-week');
  assert.equal(dayHeaders.length, 7, 'renders all 7 day sections');
  assert.equal(dayHeaders[0].textContent, 'Monday (Today)');
  assert.equal(dayHeaders[1].textContent, 'Tuesday');

  const openHours = document.querySelectorAll('.open-hours');
  assert.equal(openHours.length, 2, 'renders hours for cards in multiple days');

  const todayStatus = openHours[0].querySelector('.open');
  assert.ok(todayStatus, 'today card shows open/closed status label');
  assert.equal(todayStatus.textContent, 'Open');

  const futureStatus = openHours[1].querySelector('.open') || openHours[1].querySelector('.closed');
  assert.equal(futureStatus, null, 'future day card does not render open/closed status label');
});
