const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadRenderMapContext() {
  const listeners = {};
  const mockMap = {
    addListener(event, callback) {
      listeners[event] = callback;
    }
  };

  const context = {
    console,
    Date,
    setTimeout,
    clearTimeout,
    startupPayload: {},
    mapSelectedDayKey: null,
    DAYS_FULL: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    activeFilters: { neighborhoods: [], types: [] },
    specialMatchesTypeFilters: () => true,
    buildHomeBarSpecials: () => ({}),
    animateTapAndNavigate: () => {},
    showDetail: () => {},
    currentTab: 'map',
    document: { getElementById: () => null, createElement: () => ({}) },
    window: {},
    google: { maps: { marker: {} } }
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/render-map.js', 'utf8'), context);
  context.__mockMap = mockMap;
  vm.runInContext('barsMap = __mockMap;', context);
  return { context, listeners, mockMap };
}

function createStrictDocument() {
  const byId = new Map();
  const makeElement = () => ({
    __isElement: true,
    children: [],
    className: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    appendChild(child) {
      if (!child || child.__isElement !== true) {
        throw new TypeError('appendChild expects an element');
      }
      this.children.push(child);
    },
    addEventListener() {},
    setPointerCapture() {}
  });

  const document = {
    createElement: makeElement,
    getElementById(id) {
      return byId.get(id) || null;
    }
  };

  const sheet = makeElement();
  sheet.style.display = 'none';
  const content = makeElement();
  byId.set('map-selected-card-sheet', sheet);
  byId.set('map-selected-card-content', content);

  return { document, sheet, content, makeElement };
}

test('bindAdvancedMarkerClick binds click and gmp-click handlers', () => {
  const { context } = loadRenderMapContext();
  const calls = [];
  const marker = {
    addListener(name) {
      calls.push(name);
    },
    addEventListener(name) {
      calls.push(name);
    }
  };

  context.bindAdvancedMarkerClick(marker, () => {});
  assert.deepEqual(calls, ['click', 'gmp-click']);
});

test('map click dismissal ignores immediate click after marker tap', () => {
  const { context, listeners, mockMap } = loadRenderMapContext();
  let dismissCalls = 0;

  context.dismissMapSelectedBarSheetAnimated = () => { dismissCalls += 1; };
  context.__mockMap = mockMap;
  vm.runInContext('barsMap = __mockMap; mapDismissListenersBound = false; mapSelectedBarSheetState.barId = "1"; mapLastMarkerTapAt = Date.now();', context);

  context.bindMapInteractionDismiss();
  listeners.click();
  assert.equal(dismissCalls, 0);
});

test('showMapSelectedBarSheet appends homeSpecials.content element', () => {
  const { context } = loadRenderMapContext();
  const { document, sheet, content, makeElement } = createStrictDocument();
  context.document = document;
  context.window = {};
  context.buildHomeBarSpecials = () => ({ content: makeElement(), hasActiveOrUpcoming: true });

  context.showMapSelectedBarSheet({ bar_id: 1, name: 'Test Bar' }, ['100'], 'MON', 'Monday');

  assert.equal(sheet.style.display, '');
  assert.equal(content.children.length, 1);
});
