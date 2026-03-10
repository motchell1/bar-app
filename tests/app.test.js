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
  const context = {
    console,
    document,
    window: { document },
    lucide: { createIcons() {} },
    fetch: async () => ({ json: async () => ({ bars: [] }) }),
    setTimeout,
    clearTimeout,
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

test('clicking favorites star unfavorites and removes card from list', () => {
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

  const favoriteCount = vm.runInContext('favorites.length', ctx);
  assert.equal(favoriteCount, 0, 'favorite removed from store');

  const cards = document.querySelectorAll('.bar-card');
  assert.equal(cards.length, 0, 'favorite card removed after rerender');

  const emptyState = document.querySelector('.no-specials-line');
  assert.ok(emptyState, 'empty state shown after removing last favorite');
});
