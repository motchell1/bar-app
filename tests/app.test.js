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
  const source = fs.readFileSync('js/app.js', 'utf8');
  const trimmed = source.split('// ===== Initialize =====')[0];
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
  vm.runInContext(trimmed, context);
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

  const item = {
    id: '1',
    bar: { id: 1, name: 'Test Bar', neighborhood: 'Downtown' },
    special: { description: '$5 Beer', type: 'drink', all_day: true },
    dayLabel: 'Monday'
  };

  vm.runInContext(`favorites = [${JSON.stringify(item)}]; currentTab = 'favorites'; activeFilters.types = []; activeFilters.neighborhoods = [];`, ctx);
  ctx.renderFavorites([item]);

  const card = document.querySelector('.bar-card');
  assert.ok(card, 'renders a favorites card');
  assert.ok(card.querySelector('.special-card-header-row'), 'renders header row');
  assert.ok(card.querySelector('.special-favorite-button'), 'renders favorite button');
  assert.equal(card.querySelector('.bar-neighborhood'), null, 'does not render neighborhood label');
});

test('clicking favorites star unfavorites and removes card from list', async () => {
  const document = new DocumentMock();
  mountBaseNodes(document);
  const ctx = loadAppWithoutBoot(document);

  const bar = { id: 1, name: 'Test Bar', neighborhood: 'Downtown' };
  const special = {
    description: '$5 Beer',
    type: 'drink',
    day: 'MON',
    all_day: false,
    start_time: '16:00',
    end_time: '18:00'
  };
  const dayLabel = 'Monday';
  const id = ctx.getSpecialId(bar, special, dayLabel);
  const item = { id, bar, special, dayLabel };

  vm.runInContext(`favorites = [${JSON.stringify(item)}]; currentTab = 'favorites'; activeFilters.types = []; activeFilters.neighborhoods = [];`, ctx);
  ctx.renderFavorites([item]);

  const favoriteButton = document.querySelector('.special-favorite-button');
  assert.ok(favoriteButton, 'favorite button exists before click');

  favoriteButton.click();

  await new Promise((resolve) => setTimeout(resolve, 760));

  const favoriteCount = vm.runInContext('favorites.length', ctx);
  assert.equal(favoriteCount, 0, 'favorite removed from store');

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
