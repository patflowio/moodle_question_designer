// Speicherung im Browser (localStorage) – wie ein Zwischenspeicher, der beim
// nächsten Öffnen wieder da ist.
import { uid } from './util.js';
import { normalizeQuestion } from './types.js';

const KEY = 'moodle-question-designer:v1';
export const SCHEMA_VERSION = 1;

export function newCatalog(name = 'Mein Fragenkatalog') {
  return {
    id: uid(),
    name,
    category: '$course$/top/' + name,
    questions: [],
    tests: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function defaultState() {
  const cat = newCatalog();
  return { version: SCHEMA_VERSION, activeId: cat.id, catalogs: [cat] };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    return normalizeState(data);
  } catch (err) {
    console.warn('Gespeicherte Daten konnten nicht gelesen werden', err);
    return defaultState();
  }
}

export function normalizeState(data) {
  const state = defaultState();
  if (data && Array.isArray(data.catalogs) && data.catalogs.length) {
    state.catalogs = data.catalogs.map(normalizeCatalog);
    state.activeId = state.catalogs.some((c) => c.id === data.activeId) ? data.activeId : state.catalogs[0].id;
  }
  return state;
}

export function normalizeCatalog(c) {
  const base = newCatalog(c?.name || 'Fragenkatalog');
  return {
    ...base,
    ...c,
    id: c?.id || base.id,
    questions: Array.isArray(c?.questions) ? c.questions.map(normalizeQuestion) : [],
    tests: Array.isArray(c?.tests) ? c.tests.map(normalizeTest).filter(Boolean) : [],
  };
}

export function normalizeTest(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    id: t.id || uid(),
    name: String(t.name || 'Test'),
    description: String(t.description || ''),
    questionIds: Array.isArray(t.questionIds) ? t.questionIds.filter((id) => typeof id === 'string') : [],
    createdAt: t.createdAt || Date.now(),
  };
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('Speichern fehlgeschlagen', err);
    return false;
  }
}

export function storageAvailable() {
  try {
    const k = '__test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function makeBackup(catalogs) {
  return JSON.stringify(
    {
      app: 'moodle-question-designer',
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      catalogs,
    },
    null,
    2,
  );
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  const catalogs = Array.isArray(data?.catalogs) ? data.catalogs : data?.questions ? [data] : null;
  if (!catalogs) throw new Error('Das ist keine Sicherungsdatei dieses Tools.');
  return catalogs.map((c) => normalizeCatalog({ ...c, id: uid() }));
}
