// Oberfläche: Liste, Editor, Modale, Export/Import.
import { TYPES, TYPE_ORDER, createQuestion, newAnswer, newPair, validateQuestion, multichoiceFractions, FRACTION_OPTIONS, PENALTY_OPTIONS, normalizeQuestion } from './types.js';
import * as store from './store.js';
import { exportMoodleXml } from './export-xml.js';
import { exportGift } from './export-gift.js';
import { importMoodleXml } from './import-xml.js';
import { h, uid, download, debounce, escapeHtml, textToHtml, stripHtml, slugify, formatFraction, formatDate, pluralize } from './util.js';

const $ = (sel) => document.querySelector(sel);

let state = store.load();
const ui = { tab: 'questions', selectedId: null, selectedTestId: null, search: '', checked: new Set(), showAnswerFeedback: false };

// ---------- Datenzugriff ----------
function catalog() {
  return state.catalogs.find((c) => c.id === state.activeId) || state.catalogs[0];
}
function questions() {
  return catalog().questions;
}
function selectedQuestion() {
  return questions().find((q) => q.id === ui.selectedId) || null;
}

// ---------- Speichern ----------
const persist = debounce(() => {
  setStatus(store.save(state) ? 'saved' : 'error');
}, 300);
function touch() {
  catalog().updatedAt = Date.now();
  setStatus('saving');
  persist();
}
function setStatus(s) {
  const el = $('#save-status');
  el.dataset.state = s;
  el.querySelector('.label').textContent = s === 'saving' ? 'Speichert …' : s === 'error' ? 'Speichern fehlgeschlagen' : 'Gespeichert';
}
window.addEventListener('pagehide', () => persist.flush());
document.addEventListener('visibilitychange', () => document.hidden && persist.flush());

// ---------- Toast / Modale ----------
function toast(msg, kind = '', action = null) {
  const el = h('div', { class: 'toast ' + kind }, [
    h('span', {}, msg),
    action ? h('button', { type: 'button', onclick: () => { el.remove(); action.onAction(); } }, action.label) : null,
  ]);
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), action ? 8000 : 3500);
}

function openModal({ title, body, actions = [], wide = false, onClose }) {
  const root = $('#modal-root');
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const foot = h('div', { class: 'modal-foot' });
  for (const a of actions) {
    const btn = h('button', { class: 'btn ' + (a.class || ''), onclick: () => a.onClick?.(close), disabled: a.disabled }, a.label);
    if (a.left) btn.classList.add('left');
    foot.appendChild(btn);
  }
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => e.target === backdrop && close() }, [
    h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, title), h('button', { class: 'btn icon ghost', onclick: close, 'aria-label': 'Schließen' }, '✕')]),
      h('div', { class: 'modal-body' }, body),
      actions.length ? foot : null,
    ]),
  ]);
  root.appendChild(backdrop);
  document.addEventListener('keydown', onKey);
  const focusable = backdrop.querySelector('input, select, textarea, button.primary, button');
  focusable?.focus();
  return close;
}

function confirmDialog(message, { okLabel = 'OK', danger = false, title = 'Bestätigen' } = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: h('p', {}, message),
      actions: [
        { label: 'Abbrechen', onClick: (close) => { close(); resolve(false); } },
        { label: okLabel, class: danger ? 'danger' : 'primary', onClick: (close) => { close(); resolve(true); } },
      ],
      onClose: () => resolve(false),
    });
  });
}

function promptDialog(title, label, value = '') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value });
    let done = false;
    const finish = (v, close) => { done = true; close(); resolve(v); };
    const close = openModal({
      title,
      body: h('form', { onsubmit: (e) => { e.preventDefault(); finish(input.value.trim(), close); } }, [field(label, input)]),
      actions: [
        { label: 'Abbrechen', onClick: (c) => finish(null, c) },
        { label: 'OK', class: 'primary', onClick: (c) => finish(input.value.trim(), c) },
      ],
      onClose: () => !done && resolve(null),
    });
    input.focus();
    input.select();
  });
}

// ---------- Formular-Helfer ----------
function field(label, control, hint, { optional = false } = {}) {
  return h('div', { class: 'field' }, [
    label ? h('label', { class: 'field-label' }, [label, optional ? h('span', { class: 'optional' }, ' (optional)') : null]) : null,
    control,
    hint ? h('div', { class: 'hint', html: hint }) : null,
  ]);
}

function afterChange(q) {
  touch();
  if (q) {
    refreshValidation(q);
    refreshListItem(q);
  }
}

function bind(obj, key, input, { onChange, number = false, q = null } = {}) {
  input.addEventListener('input', () => {
    let v = input.type === 'checkbox' ? input.checked : input.value;
    if (number) v = v === '' ? '' : Number(String(v).replace(',', '.'));
    obj[key] = v;
    afterChange(q);
    onChange?.(v);
  });
  return input;
}

function textInput(obj, key, attrs = {}, opts = {}) {
  return bind(obj, key, h('input', { type: 'text', value: obj[key] ?? '', ...attrs }), opts);
}
function textArea(obj, key, attrs = {}, opts = {}) {
  const t = h('textarea', { rows: 4, ...attrs });
  t.value = obj[key] ?? '';
  return bind(obj, key, t, opts);
}
function numberInput(obj, key, attrs = {}, opts = {}) {
  return bind(obj, key, h('input', { type: 'number', value: String(obj[key] ?? ''), ...attrs }), { ...opts, number: true });
}
function checkbox(obj, key, label, opts = {}) {
  const input = h('input', { type: 'checkbox', checked: !!obj[key] });
  input.addEventListener('change', () => {
    obj[key] = input.checked;
    afterChange(opts.q);
    opts.onChange?.(input.checked);
  });
  return h('label', { class: 'check' }, [input, h('span', {}, label)]);
}
function selectInput(obj, key, options, opts = {}) {
  const sel = h('select', {}, options.map((o) => h('option', { value: String(o.value), selected: String(o.value) === String(obj[key]) }, o.label)));
  sel.addEventListener('change', () => {
    const raw = sel.value;
    obj[key] = opts.number ? Number(raw) : opts.bool ? raw === 'true' : raw;
    afterChange(opts.q);
    opts.onChange?.(obj[key]);
  });
  return sel;
}
function fractionSelect(obj, key, opts = {}) {
  const current = Number(obj[key]) || 0;
  const values = FRACTION_OPTIONS.includes(current) ? FRACTION_OPTIONS : [current, ...FRACTION_OPTIONS];
  const sel = selectInput(obj, key, values.map((v) => ({ value: v, label: formatFraction(v).replace('.', ',') + ' %' })), { ...opts, number: true });
  sel.classList.add('frac-select');
  sel.title = 'Prozent der Punkte';
  return sel;
}
function removeButton(onClick, disabled = false) {
  return h('button', { class: 'remove-btn', type: 'button', title: 'Entfernen', 'aria-label': 'Entfernen', onclick: onClick, disabled }, '✕');
}

// ---------- Kopfzeile ----------
function renderHeader() {
  const sel = $('#catalog-select');
  sel.innerHTML = '';
  for (const c of state.catalogs) {
    sel.appendChild(h('option', { value: c.id, selected: c.id === catalog().id }, `${c.name} (${c.questions.length})`));
  }
  document.title = `${catalog().name} – Moodle Fragen-Designer`;
}

function switchCatalog(id) {
  state.activeId = id;
  ui.selectedId = null;
  ui.selectedTestId = null;
  ui.checked.clear();
  ui.search = '';
  $('#search').value = '';
  touch();
  renderAll();
}

// ---------- Liste ----------
function visibleQuestions() {
  const s = ui.search.trim().toLowerCase();
  if (!s) return questions();
  return questions().filter((q) => (q.name + ' ' + stripHtml(q.text) + ' ' + (q.tags || '')).toLowerCase().includes(s));
}

function renderList() {
  const list = $('#question-list');
  list.innerHTML = '';
  const all = questions();
  const visible = visibleQuestions();
  if (!all.length) {
    list.appendChild(h('li', { class: 'list-empty' }, 'Noch keine Fragen. Klicke auf „Neue Frage“.'));
  } else if (!visible.length) {
    list.appendChild(h('li', { class: 'list-empty' }, 'Keine Treffer.'));
  }
  visible.forEach((q) => list.appendChild(listItem(q, all.indexOf(q) + 1)));
  const n = all.length;
  const k = ui.checked.size;
  $('#list-count').textContent = k ? `${k} von ${n} ausgewählt` : pluralize(n, 'Frage', 'Fragen');
  $('#btn-add-to-test').hidden = k === 0;
  const checkAll = $('#check-all');
  checkAll.checked = n > 0 && all.every((q) => ui.checked.has(q.id));
  checkAll.indeterminate = k > 0 && !checkAll.checked;
  checkAll.disabled = n === 0;
}

function listItem(q, number) {
  const problems = validateQuestion(q);
  const check = h('input', { type: 'checkbox', class: 'q-check', checked: ui.checked.has(q.id), title: 'Für Export auswählen', onclick: (e) => e.stopPropagation() });
  check.addEventListener('change', () => {
    check.checked ? ui.checked.add(q.id) : ui.checked.delete(q.id);
    renderList();
  });
  const li = h('li', {
    class: 'q-item' + (q.id === ui.selectedId ? ' selected' : ''),
    dataset: { id: q.id },
    draggable: 'true',
    onclick: () => selectQuestion(q.id),
  }, [
    check,
    h('span', { class: 'q-num' }, String(number)),
    h('span', { class: 'q-badge', title: TYPES[q.type]?.label }, TYPES[q.type]?.short || '?'),
    h('span', { class: 'q-title' + (q.name ? '' : ' empty') }, q.name || 'Ohne Titel'),
    problems.length ? h('span', { class: 'q-warn', title: problems.join('\n') }, '!') : null,
  ]);
  // Drag & Drop
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', q.id);
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => li.classList.remove('dragging'));
  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    const before = e.offsetY < li.offsetHeight / 2;
    li.classList.toggle('drop-before', before);
    li.classList.toggle('drop-after', !before);
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    const before = li.classList.contains('drop-before');
    li.classList.remove('drop-before', 'drop-after');
    moveQuestion(e.dataTransfer.getData('text/plain'), q.id, before);
  });
  return li;
}

function refreshListItem(q) {
  const li = $(`#question-list li[data-id="${q.id}"]`);
  if (!li) return;
  const title = li.querySelector('.q-title');
  title.textContent = q.name || 'Ohne Titel';
  title.classList.toggle('empty', !q.name);
  const problems = validateQuestion(q);
  let warn = li.querySelector('.q-warn');
  if (problems.length) {
    if (!warn) li.appendChild((warn = h('span', { class: 'q-warn' }, '!')));
    warn.title = problems.join('\n');
  } else warn?.remove();
}

function moveQuestion(fromId, toId, before) {
  if (!fromId || fromId === toId) return;
  const list = questions();
  const fromIdx = list.findIndex((q) => q.id === fromId);
  if (fromIdx < 0) return;
  const [item] = list.splice(fromIdx, 1);
  let toIdx = list.findIndex((q) => q.id === toId);
  if (toIdx < 0) toIdx = list.length;
  else if (!before) toIdx += 1;
  list.splice(toIdx, 0, item);
  touch();
  renderList();
}

function selectQuestion(id) {
  ui.selectedId = id;
  renderList();
  renderEditor();
}

// ---------- Aktionen ----------
function addQuestion(type) {
  const q = createQuestion(type);
  questions().push(q);
  ui.selectedId = q.id;
  touch();
  renderAll();
  $('#q-name')?.focus();
}

function duplicateQuestion(q) {
  const copy = structuredClone(q);
  copy.id = uid();
  copy.name = q.name ? q.name + ' (Kopie)' : '';
  copy.createdAt = Date.now();
  (copy.answers || []).forEach((a) => (a.id = uid()));
  (copy.pairs || []).forEach((p) => (p.id = uid()));
  const idx = questions().indexOf(q);
  questions().splice(idx + 1, 0, copy);
  ui.selectedId = copy.id;
  touch();
  renderAll();
  toast('Frage dupliziert.');
}

function deleteQuestion(q) {
  const list = questions();
  const idx = list.indexOf(q);
  const memberships = tests().map((t) => [t.id, t.questionIds.indexOf(q.id)]).filter(([, i]) => i >= 0);
  list.splice(idx, 1);
  tests().forEach((t) => (t.questionIds = t.questionIds.filter((id) => id !== q.id)));
  ui.checked.delete(q.id);
  ui.selectedId = list[Math.min(idx, list.length - 1)]?.id ?? null;
  touch();
  renderAll();
  toast(`„${q.name || 'Ohne Titel'}“ gelöscht.`, '', {
    label: 'Rückgängig',
    onAction: () => {
      const cur = questions();
      if (cur.some((x) => x.id === q.id)) return;
      cur.splice(Math.min(idx, cur.length), 0, q);
      memberships.forEach(([tid, i]) => {
        const t = tests().find((x) => x.id === tid);
        if (t && !t.questionIds.includes(q.id)) t.questionIds.splice(Math.min(i, t.questionIds.length), 0, q.id);
      });
      ui.tab = 'questions';
      ui.selectedId = q.id;
      touch();
      renderAll();
    },
  });
}

function shiftQuestion(q, delta) {
  const list = questions();
  const idx = list.indexOf(q);
  const to = idx + delta;
  if (to < 0 || to >= list.length) return;
  list.splice(idx, 1);
  list.splice(to, 0, q);
  touch();
  renderList();
}

// ---------- Editor ----------
function renderEditor() {
  const root = $('#editor');
  root.innerHTML = '';
  if (ui.tab === 'tests') {
    renderTestEditor(root);
    return;
  }
  const q = selectedQuestion();
  if (!q) {
    root.appendChild(emptyState());
    return;
  }
  const inner = h('div', { class: 'editor-inner' });
  const list = questions();
  const idx = list.indexOf(q);
  inner.appendChild(
    h('div', { class: 'editor-head' }, [
      h('span', { class: 'type-pill' }, [TYPES[q.type].icon + ' ', TYPES[q.type].label]),
      h('h2', {}, `Frage ${idx + 1} von ${list.length}`),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => shiftQuestion(q, -1), disabled: idx === 0, title: 'Nach oben' }, '↑'),
      h('button', { class: 'btn small', onclick: () => shiftQuestion(q, 1), disabled: idx === list.length - 1, title: 'Nach unten' }, '↓'),
      h('button', { class: 'btn small', onclick: () => openPreview(q) }, 'Vorschau'),
      h('button', { class: 'btn small', onclick: () => duplicateQuestion(q) }, 'Duplizieren'),
      h('button', { class: 'btn small danger', onclick: () => deleteQuestion(q) }, 'Löschen'),
    ]),
  );
  inner.appendChild(h('div', { id: 'validation' }));
  inner.appendChild(generalCard(q));
  const specific = typeEditor(q);
  if (specific) inner.appendChild(specific);
  inner.appendChild(feedbackCard(q));
  root.appendChild(inner);
  refreshValidation(q);
}

function refreshValidation(q) {
  const box = $('#validation');
  if (!box) return;
  const problems = validateQuestion(q);
  box.innerHTML = '';
  if (!problems.length) {
    box.appendChild(h('div', { class: 'banner ok' }, '✓ Diese Frage ist vollständig und kann exportiert werden.'));
  } else {
    box.appendChild(h('div', { class: 'banner warn' }, [h('strong', {}, 'Noch unvollständig:'), h('ul', {}, problems.map((p) => h('li', {}, p)))]));
  }
}

function emptyState() {
  const hasQuestions = questions().length > 0;
  return h('div', { class: 'empty-state' }, [
    h('h2', {}, hasQuestions ? 'Frage auswählen oder neue Frage anlegen' : 'Willkommen! Womit möchtest du starten?'),
    h('p', {}, hasQuestions ? 'Klicke links auf eine Frage, um sie zu bearbeiten – oder wähle hier einen Fragetyp.' : 'Wähle einen Fragetyp. Alles, was du eingibst, wird automatisch in deinem Browser gespeichert.'),
    typeGrid(),
  ]);
}

function typeGrid(onPick = addQuestion) {
  return h('div', { class: 'type-grid' }, TYPE_ORDER.map((t) =>
    h('button', { class: 'type-card', type: 'button', onclick: () => onPick(t) }, [
      h('span', { class: 'type-icon' }, TYPES[t].icon),
      h('span', { class: 'type-label' }, TYPES[t].label),
      h('span', { class: 'type-desc' }, TYPES[t].desc),
    ]),
  ));
}

function generalCard(q) {
  const isCloze = q.type === 'cloze';
  const textHint = isCloze
    ? 'Lücken werden direkt im Text mit geschweiften Klammern eingetragen – siehe unten.'
    : 'Einfacher Text oder HTML. Leerzeilen werden zu Absätzen. Bilder: <code>&lt;img src="https://…"&gt;</code>';
  const textarea = textArea(q, 'text', { id: 'q-text', rows: isCloze ? 8 : 5, placeholder: isCloze ? 'Die Hauptstadt von Frankreich ist {1:SHORTANSWER:=Paris}.' : 'Fragetext …', class: isCloze ? 'mono' : '' }, { q });
  const children = [
    h('h3', {}, 'Frage'),
    field('Titel', textInput(q, 'name', { id: 'q-name', placeholder: 'Kurzer Titel, z. B. „Hauptstadt Frankreich“' }, { q }), 'Der Titel erscheint nur in der Moodle-Fragensammlung, nicht im Test.'),
    field(q.type === 'description' ? 'Text' : 'Fragetext', textarea, textHint),
  ];
  if (isCloze) children.push(clozeTools(textarea, q));
  if (q.type !== 'description') {
    children.push(
      h('div', { class: 'row' }, [
        field('Punkte', numberInput(q, 'defaultGrade', { min: 0, step: '0.5', style: { maxWidth: '10em' } }, { q }), 'Standard-Bewertung dieser Frage im Test.'),
      ]),
    );
  }
  return h('div', { class: 'card' }, children);
}

function typeEditor(q) {
  switch (q.type) {
    case 'multichoice': return editMultichoice(q);
    case 'truefalse': return editTrueFalse(q);
    case 'shortanswer': return editShortAnswer(q);
    case 'numerical': return editNumerical(q);
    case 'matching': return editMatching(q);
    case 'essay': return editEssay(q);
    default: return null;
  }
}

function answerFeedbackToggle() {
  const input = h('input', { type: 'checkbox', checked: ui.showAnswerFeedback });
  input.addEventListener('change', () => { ui.showAnswerFeedback = input.checked; renderEditor(); });
  return h('label', { class: 'check' }, [input, h('span', {}, 'Feedback je Antwort')]);
}

function editMultichoice(q) {
  const card = h('div', { class: 'card' });
  card.appendChild(h('h3', {}, ['Antwortmöglichkeiten', h('span', { class: 'muted' }, 'Richtige Antwort(en) markieren')]));
  card.appendChild(
    h('div', { class: 'options' }, [
      h('span', { class: 'inline' }, [
        selectInput(q, 'single', [{ value: 'true', label: 'Nur eine Antwort richtig' }, { value: 'false', label: 'Mehrere Antworten richtig' }], {
          bool: true, q,
          onChange: (single) => {
            if (single) {
              const first = q.answers.find((a) => a.correct);
              q.answers.forEach((a) => (a.correct = a === first));
            }
            renderEditor();
          },
        }),
      ]),
      checkbox(q, 'shuffle', 'Antworten mischen', { q }),
      h('span', { class: 'inline' }, ['Nummerierung ', selectInput(q, 'numbering', [
        { value: 'abc', label: 'a., b., c.' }, { value: 'ABCD', label: 'A., B., C.' }, { value: '123', label: '1., 2., 3.' }, { value: 'iii', label: 'i., ii., iii.' }, { value: 'IIII', label: 'I., II., III.' }, { value: 'none', label: 'keine' },
      ], { q })]),
      q.single ? null : checkbox(q, 'autoFractions', 'Punkte automatisch verteilen', { q, onChange: () => renderEditor() }),
      answerFeedbackToggle(),
    ]),
  );
  const list = h('div', { class: 'answers' });
  const refreshFractions = () => {
    const fr = multichoiceFractions(q);
    list.querySelectorAll('.frac').forEach((el, i) => {
      const f = fr[i];
      el.textContent = formatFraction(f).replace('.', ',') + ' %';
      el.className = 'frac ' + (f > 0 ? 'pos' : f < 0 ? 'neg' : '');
    });
  };
  const rebuild = () => {
    list.innerHTML = '';
    q.answers.forEach((a, i) => {
      let correctCtl;
      if (q.single) {
        correctCtl = h('input', { type: 'radio', name: 'correct-' + q.id, checked: a.correct, title: 'Richtige Antwort' });
        correctCtl.addEventListener('change', () => { q.answers.forEach((x) => (x.correct = x === a)); afterChange(q); refreshFractions(); });
      } else {
        correctCtl = h('input', { type: 'checkbox', checked: a.correct, title: 'Richtige Antwort' });
        correctCtl.addEventListener('change', () => { a.correct = correctCtl.checked; afterChange(q); refreshFractions(); });
      }
      const fractionCtl = q.single || q.autoFractions
        ? h('span', { class: 'frac' }, '')
        : fractionSelect(a, 'fraction', { q, onChange: (v) => { a.correct = v > 0; } });
      list.appendChild(
        h('div', { class: 'answer-row' + (ui.showAnswerFeedback ? ' with-feedback' : '') }, [
          h('span', { class: 'correct-toggle' }, correctCtl),
          textInput(a, 'text', { placeholder: `Antwort ${i + 1}` }, { q }),
          ui.showAnswerFeedback ? textInput(a, 'feedback', { placeholder: 'Feedback zu dieser Antwort', class: 'answer-feedback' }, { q }) : null,
          fractionCtl,
          removeButton(() => { q.answers.splice(i, 1); afterChange(q); rebuild(); }, q.answers.length <= 2),
        ]),
      );
    });
    refreshFractions();
  };
  rebuild();
  card.appendChild(list);
  card.appendChild(h('button', { class: 'btn small', type: 'button', onclick: () => { q.answers.push(newAnswer()); afterChange(q); rebuild(); list.lastChild.querySelector('input[type=text]').focus(); } }, '＋ Antwort hinzufügen'));
  card.appendChild(h('div', { class: 'hint' }, q.single
    ? 'Die richtige Antwort erhält 100 %.'
    : q.autoFractions
      ? 'Richtige Antworten teilen sich 100 %, falsche Antworten ziehen denselben Anteil ab (so bringt „alles ankreuzen“ 0 Punkte).'
      : 'Positive Prozentwerte müssen zusammen 100 % ergeben.'));
  return card;
}

function editTrueFalse(q) {
  const radio = (val, label) => {
    const input = h('input', { type: 'radio', name: 'tf-' + q.id, checked: q.correctAnswer === val });
    input.addEventListener('change', () => { q.correctAnswer = val; afterChange(q); });
    return h('label', { class: 'check' }, [input, h('span', {}, label)]);
  };
  return h('div', { class: 'card' }, [
    h('h3', {}, 'Richtige Antwort'),
    h('div', { class: 'options' }, [radio(true, 'Wahr'), radio(false, 'Falsch')]),
    h('div', { class: 'row' }, [
      field('Feedback bei Antwort „Wahr“', textInput(q, 'feedbackTrue', {}, { q }), null, { optional: true }),
      field('Feedback bei Antwort „Falsch“', textInput(q, 'feedbackFalse', {}, { q }), null, { optional: true }),
    ]),
  ]);
}

function editShortAnswer(q) {
  const card = h('div', { class: 'card' });
  card.appendChild(h('h3', {}, ['Akzeptierte Antworten', h('span', { class: 'muted' }, 'Jede Zeile eine mögliche Antwort')]));
  card.appendChild(h('div', { class: 'options' }, [checkbox(q, 'usecase', 'Groß-/Kleinschreibung beachten', { q }), answerFeedbackToggle()]));
  const list = h('div', { class: 'answers' });
  const rebuild = () => {
    list.innerHTML = '';
    q.answers.forEach((a, i) => {
      list.appendChild(
        h('div', { class: 'answer-row' + (ui.showAnswerFeedback ? ' with-feedback' : '') }, [
          h('span', { class: 'correct-toggle muted' }, String(i + 1)),
          textInput(a, 'text', { placeholder: 'Antwort, z. B. Paris' }, { q }),
          ui.showAnswerFeedback ? textInput(a, 'feedback', { placeholder: 'Feedback', class: 'answer-feedback' }, { q }) : null,
          fractionSelect(a, 'fraction', { q }),
          removeButton(() => { q.answers.splice(i, 1); afterChange(q); rebuild(); }, q.answers.length <= 1),
        ]),
      );
    });
  };
  rebuild();
  card.appendChild(list);
  card.appendChild(h('button', { class: 'btn small', type: 'button', onclick: () => { q.answers.push(newAnswer({ fraction: 100 })); afterChange(q); rebuild(); list.lastChild.querySelector('input[type=text]').focus(); } }, '＋ Antwort hinzufügen'));
  card.appendChild(h('div', { class: 'hint', html: 'Das Sternchen <code>*</code> steht für beliebige Zeichen, z. B. <code>Par*s</code>. Alternative Schreibweisen als eigene Zeile eintragen, Teilpunkte über den Prozentwert.' }));
  return card;
}

function editNumerical(q) {
  const card = h('div', { class: 'card' });
  card.appendChild(h('h3', {}, 'Richtige Zahl(en)'));
  card.appendChild(h('div', { class: 'options' }, [answerFeedbackToggle()]));
  const list = h('div', { class: 'answers' });
  const rebuild = () => {
    list.innerHTML = '';
    list.appendChild(h('div', { class: 'num-row' + (ui.showAnswerFeedback ? ' with-feedback' : '') }, [
      h('span', { class: 'col-head' }, 'Wert'), h('span', { class: 'col-head' }, 'Toleranz ±'), h('span', { class: 'col-head' }, 'Punkte'), ui.showAnswerFeedback ? h('span', { class: 'col-head' }, 'Feedback') : null, h('span'),
    ]));
    q.answers.forEach((a, i) => {
      list.appendChild(
        h('div', { class: 'num-row' + (ui.showAnswerFeedback ? ' with-feedback' : '') }, [
          textInput(a, 'text', { placeholder: 'z. B. 42 oder 3,14', inputmode: 'decimal' }, { q }),
          textInput(a, 'tolerance', { placeholder: '0', inputmode: 'decimal' }, { q }),
          fractionSelect(a, 'fraction', { q }),
          ui.showAnswerFeedback ? textInput(a, 'feedback', { placeholder: 'Feedback' }, { q }) : null,
          removeButton(() => { q.answers.splice(i, 1); afterChange(q); rebuild(); }, q.answers.length <= 1),
        ]),
      );
    });
  };
  rebuild();
  card.appendChild(list);
  card.appendChild(h('button', { class: 'btn small', type: 'button', onclick: () => { q.answers.push(newAnswer({ fraction: 100 })); afterChange(q); rebuild(); } }, '＋ Weitere Zahl'));
  card.appendChild(h('div', { class: 'hint', html: 'Mit der Toleranz gelten auch Werte im Bereich Wert ± Toleranz als richtig. Ein Sternchen <code>*</code> als Wert fängt alle übrigen Eingaben ab (z. B. mit 0 % und Feedback).' }));
  return card;
}

function editMatching(q) {
  const card = h('div', { class: 'card' });
  card.appendChild(h('h3', {}, ['Paare', h('span', { class: 'muted' }, 'Links die Frage, rechts die passende Antwort')]));
  card.appendChild(h('div', { class: 'options' }, [checkbox(q, 'shuffle', 'Reihenfolge mischen', { q })]));
  const list = h('div', { class: 'answers' });
  const rebuild = () => {
    list.innerHTML = '';
    q.pairs.forEach((p, i) => {
      list.appendChild(
        h('div', { class: 'pair-row' }, [
          textInput(p, 'question', { placeholder: `Frage ${i + 1}, z. B. Deutschland` }, { q }),
          h('span', { class: 'arrow' }, '→'),
          textInput(p, 'answer', { placeholder: 'Antwort, z. B. Berlin' }, { q }),
          removeButton(() => { q.pairs.splice(i, 1); afterChange(q); rebuild(); }, q.pairs.length <= 2),
        ]),
      );
    });
  };
  rebuild();
  card.appendChild(list);
  card.appendChild(h('button', { class: 'btn small', type: 'button', onclick: () => { q.pairs.push(newPair()); afterChange(q); rebuild(); list.lastChild.querySelector('input').focus(); } }, '＋ Paar hinzufügen'));
  card.appendChild(h('div', { class: 'hint' }, 'Mindestens zwei Paare. Ein Paar nur mit Antwort (ohne Frage) ergibt eine zusätzliche falsche Auswahlmöglichkeit.'));
  return card;
}

function editEssay(q) {
  return h('div', { class: 'card' }, [
    h('h3', {}, 'Antwortfeld'),
    h('div', { class: 'row' }, [
      field('Eingabeformat', selectInput(q, 'responseFormat', [
        { value: 'editor', label: 'Texteditor (HTML)' }, { value: 'editorfilepicker', label: 'Texteditor mit Dateiupload' }, { value: 'plain', label: 'Einfacher Text' }, { value: 'monospaced', label: 'Einfacher Text, Schreibmaschinenschrift' }, { value: 'noinline', label: 'Kein Textfeld (nur Anhänge)' },
      ], { q })),
      field('Größe des Feldes', selectInput(q, 'responseFieldLines', [5, 10, 15, 20, 25, 30, 35, 40].map((n) => ({ value: n, label: `${n} Zeilen` })), { q, number: true })),
      field('Anhänge erlaubt', selectInput(q, 'attachments', [{ value: 0, label: 'Keine' }, { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: -1, label: 'Unbegrenzt' }], { q, number: true })),
    ]),
    h('div', { class: 'options' }, [checkbox(q, 'responseRequired', 'Text muss eingegeben werden', { q })]),
    field('Antwortvorlage', textArea(q, 'responseTemplate', { rows: 3, placeholder: 'Text, der im Antwortfeld vorausgefüllt wird' }, { q }), null, { optional: true }),
    field('Hinweise für Bewertende', textArea(q, 'graderInfo', { rows: 3, placeholder: 'Musterlösung oder Bewertungsraster – sehen nur Lehrende' }, { q }), null, { optional: true }),
  ]);
}

function clozeTools(textarea, q) {
  const insert = (snippet) => {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.value = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
    textarea.focus();
    q.text = textarea.value;
    afterChange(q);
  };
  const snippets = [
    ['Kurzantwort', '{1:SHORTANSWER:=richtige Antwort~%50%halb richtig}'],
    ['Auswahlliste', '{1:MULTICHOICE:=richtig~falsch~auch falsch}'],
    ['Auswahl untereinander', '{1:MULTICHOICE_V:=richtig~falsch}'],
    ['Zahl', '{1:NUMERICAL:=42:0.5}'],
  ];
  return h('div', {}, [
    h('div', { class: 'snippet-bar' }, [h('span', { class: 'small muted', style: { alignSelf: 'center' } }, 'Lücke einfügen: '), ...snippets.map(([label, s]) => h('button', { class: 'btn small', type: 'button', onclick: () => insert(s) }, label))]),
    h('details', {}, [
      h('summary', { class: 'small muted', style: { cursor: 'pointer' } }, 'Cloze-Syntax kurz erklärt'),
      h('table', { class: 'syntax-table' }, [
        h('tr', {}, [h('td', {}, h('code', {}, '{1:SHORTANSWER:=Paris}')), h('td', {}, 'Textfeld; „1“ = Punkte, „=“ = richtige Antwort')]),
        h('tr', {}, [h('td', {}, h('code', {}, '{1:MULTICHOICE:=Paris~London~Rom}')), h('td', {}, 'Auswahlliste, Alternativen mit „~“ getrennt')]),
        h('tr', {}, [h('td', {}, h('code', {}, '{2:NUMERICAL:=3.14:0.01}')), h('td', {}, 'Zahl mit Toleranz, 2 Punkte')]),
        h('tr', {}, [h('td', {}, h('code', {}, '~%50%Antwort')), h('td', {}, 'Teilpunkte in Prozent')]),
        h('tr', {}, [h('td', {}, h('code', {}, '=Paris#Genau!')), h('td', {}, 'Feedback nach „#“')]),
      ]),
    ]),
  ]);
}

function feedbackCard(q) {
  const items = [field('Allgemeines Feedback', textArea(q, 'generalFeedback', { rows: 3, placeholder: 'Wird nach der Beantwortung angezeigt – unabhängig davon, ob richtig oder falsch' }, { q }), null, { optional: true })];
  if (q.type === 'multichoice' || q.type === 'matching') {
    items.push(h('div', { class: 'row' }, [
      field('Bei richtiger Antwort', textInput(q, 'correctFeedback', {}, { q })),
      field('Bei teilweise richtiger Antwort', textInput(q, 'partialFeedback', {}, { q })),
      field('Bei falscher Antwort', textInput(q, 'incorrectFeedback', {}, { q })),
    ]));
  }
  if (!['essay', 'description', 'truefalse'].includes(q.type)) {
    items.push(field('Abzug bei jedem weiteren Versuch', selectInput(q, 'penalty', PENALTY_OPTIONS, { q, number: true }), 'Nur relevant, wenn der Test mehrere Versuche pro Frage erlaubt (z. B. „Adaptiver Modus“).'));
  }
  if (q.type !== 'description') items.push(field('Schlagwörter', textInput(q, 'tags', { placeholder: 'z. B. kapitel1, leicht' }, { q }), 'Durch Komma getrennt; werden als Moodle-Tags exportiert.', { optional: true }));
  return h('details', { class: 'card', open: !!(q.generalFeedback || q.tags) }, [h('summary', {}, 'Feedback & Erweitert'), h('div', { class: 'details-body' }, items)]);
}

// ---------- Vorschau ----------
function openPreview(q) {
  openModal({ title: 'Vorschau: ' + (q.name || 'Ohne Titel'), body: previewNode(q), wide: true, actions: [{ label: 'Schließen', class: 'primary', onClick: (c) => c() }] });
}

function previewNode(q) {
  const wrap = h('div', { class: 'preview' });
  if (q.type !== 'description') wrap.appendChild(h('div', { class: 'pv-meta' }, `${TYPES[q.type].label} · ${q.defaultGrade} ${Number(q.defaultGrade) === 1 ? 'Punkt' : 'Punkte'}`));
  wrap.appendChild(h('div', { class: 'pv-text', html: q.type === 'cloze' ? clozePreviewHtml(q.text) : textToHtml(q.text) || '<em class="muted">(kein Fragetext)</em>' }));
  const numbering = (i) => {
    const n = q.numbering || 'abc';
    if (n === 'none') return '';
    if (n === 'abc') return String.fromCharCode(97 + i) + '. ';
    if (n === 'ABCD') return String.fromCharCode(65 + i) + '. ';
    if (n === '123') return i + 1 + '. ';
    const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][i] || String(i + 1);
    return (n === 'IIII' ? roman.toUpperCase() : roman) + '. ';
  };
  switch (q.type) {
    case 'multichoice': {
      const answers = q.answers.filter((a) => a.text.trim());
      const fr = multichoiceFractions({ ...q, answers });
      wrap.appendChild(h('div', { class: 'pv-answers' }, answers.map((a, i) =>
        h('div', { class: 'pv-answer' + (fr[i] > 0 ? ' correct' : '') }, [
          h('input', { type: q.single ? 'radio' : 'checkbox', disabled: true }),
          h('span', { html: numbering(i) + textToHtml(a.text).replace(/^<p>|<\/p>$/g, '') }),
          fr[i] > 0 ? h('span', { class: 'tick' }, `✓ ${formatFraction(fr[i]).replace('.', ',')} %`) : null,
        ]))));
      break;
    }
    case 'truefalse':
      wrap.appendChild(h('div', { class: 'pv-answers' }, [true, false].map((v) =>
        h('div', { class: 'pv-answer' + (q.correctAnswer === v ? ' correct' : '') }, [h('input', { type: 'radio', disabled: true }), v ? 'Wahr' : 'Falsch', q.correctAnswer === v ? h('span', { class: 'tick' }, '✓') : null]))));
      break;
    case 'shortanswer':
      wrap.appendChild(h('p', {}, ['Antwort: ', h('span', { class: 'pv-input' }, '…')]));
      wrap.appendChild(h('div', { class: 'pv-feedback' }, ['Akzeptiert: ', ...q.answers.filter((a) => a.text.trim()).map((a, i) => h('span', {}, `${i ? ', ' : ''}${a.text} (${formatFraction(a.fraction)} %)`))]));
      break;
    case 'numerical':
      wrap.appendChild(h('p', {}, ['Antwort: ', h('span', { class: 'pv-input' }, '…')]));
      wrap.appendChild(h('div', { class: 'pv-feedback' }, ['Richtig: ', ...q.answers.filter((a) => String(a.text).trim()).map((a, i) => h('span', {}, `${i ? ', ' : ''}${a.text}${Number(a.tolerance) ? ' ± ' + a.tolerance : ''} (${formatFraction(a.fraction)} %)`))]));
      break;
    case 'matching': {
      const options = [...new Set(q.pairs.map((p) => p.answer.trim()).filter(Boolean))];
      wrap.appendChild(h('div', {}, q.pairs.filter((p) => stripHtml(p.question)).map((p) =>
        h('div', { class: 'pv-pair' }, [h('span', { html: textToHtml(p.question) }), h('span', {}, [h('span', { class: 'pv-select' }, 'Auswählen… ▾'), ' ', h('span', { class: 'muted small' }, `→ ${p.answer}`)])]))));
      wrap.appendChild(h('div', { class: 'pv-feedback' }, 'Auswahlmöglichkeiten: ' + options.join(', ')));
      break;
    }
    case 'essay':
      wrap.appendChild(h('div', { class: 'pv-essay' }, q.responseTemplate ? h('div', { style: { padding: '0.5rem', color: '#6b7280' }, html: textToHtml(q.responseTemplate) }) : null));
      break;
    default:
      break;
  }
  if (q.generalFeedback) wrap.appendChild(h('div', { class: 'pv-feedback', html: '<strong>Allgemeines Feedback:</strong> ' + textToHtml(q.generalFeedback) }));
  return wrap;
}

function clozePreviewHtml(text) {
  const html = textToHtml(text);
  return html.replace(/\{(\d*):([A-Z_]+):([^}]*)\}/g, (m, pts, type, body) => {
    const opts = body.split('~').map((s) => s.replace(/^=/, '').replace(/#.*$/, '').replace(/^%-?\d+(\.\d+)?%/, '').trim()).filter(Boolean);
    const correct = body.split('~').find((s) => s.startsWith('='))?.replace(/^=/, '').replace(/#.*$/, '').trim() || opts[0] || '';
    if (/^(MC|MULTICHOICE|MR|MULTIRESPONSE)/.test(type)) return `<span class="pv-select" title="${escapeHtml(opts.join(' | '))}">${escapeHtml(correct)} ▾</span>`;
    return `<span class="pv-gap" title="${escapeHtml(opts.join(' | '))}">${escapeHtml(correct)}</span>`;
  });
}

// ---------- Export ----------
function openExport(preset = null) {
  const cat = catalog();
  const all = questions();
  const selected = all.filter((q) => ui.checked.has(q.id));
  const test = preset?.test || null;
  const testQs = test ? testQuestions(test) : null;
  if (!(testQs || all).length) return toast(test ? 'Dieser Test enthält noch keine Fragen.' : 'Es gibt noch keine Fragen zum Exportieren.', 'error');
  let format = 'xml';
  let scope = test ? 'test' : selected.length ? 'selected' : 'all';
  const opts = { skipInvalid: true };
  const currentList = () => (scope === 'test' ? testQs : scope === 'selected' ? selected : all);
  const defaultCategory = test ? `${(cat.category || '$course$/top').replace(/\/+$/, '')}/${test.name}` : cat.category || '';

  const radio = (name, value, current, title, desc, onChange, disabled = false) => {
    const input = h('input', { type: 'radio', name, value, checked: value === current, disabled });
    input.addEventListener('change', () => input.checked && onChange(value));
    return h('label', { class: 'choice' }, [input, h('div', {}, [h('div', { class: 'choice-title' }, title), desc ? h('div', { class: 'choice-desc' }, desc) : null])]);
  };
  const categoryInput = h('input', { type: 'text', value: defaultCategory });
  if (!test) categoryInput.addEventListener('input', () => { cat.category = categoryInput.value; touch(); });
  const filenameInput = h('input', { type: 'text', value: slugify(test ? test.name : cat.name) });
  const summary = h('div', { class: 'banner info' });
  const update = () => {
    const list = currentList();
    const invalid = list.filter((q) => validateQuestion(q).length);
    const cloze = format === 'gift' ? list.filter((q) => q.type === 'cloze') : [];
    summary.innerHTML = '';
    const parts = [h('div', {}, `${pluralize(list.length, 'Frage', 'Fragen')} werden exportiert.`)];
    if (format !== 'json' && invalid.length) parts.push(h('div', {}, `${invalid.length} davon unvollständig (mit „!“ markiert): ${opts.skipInvalid ? 'werden übersprungen.' : 'werden trotzdem exportiert – Moodle könnte den Import ablehnen.'}`));
    if (cloze.length) parts.push(h('div', {}, `${pluralize(cloze.length, 'Lückentext-Frage', 'Lückentext-Fragen')} können im GIFT-Format nicht exportiert werden und werden übersprungen.`));
    parts.forEach((p) => summary.appendChild(p));
    categoryField.style.display = format === 'json' ? 'none' : '';
    skipField.style.display = format === 'json' ? 'none' : '';
  };
  const skipInput = h('input', { type: 'checkbox', checked: true });
  skipInput.addEventListener('change', () => { opts.skipInvalid = skipInput.checked; update(); });
  const skipField = h('div', { class: 'field' }, h('label', { class: 'check' }, [skipInput, h('span', {}, 'Unvollständige Fragen überspringen')]));
  const categoryField = field('Kategorie in Moodle', categoryInput, test
    ? 'Die Fragen dieses Tests landen beim Import in dieser (Unter-)Kategorie, sodass sie in Moodle leicht in einen Test zu übernehmen sind.'
    : 'Wird beim Import als Fragenkategorie angelegt. <code>$course$/top/</code> steht für die oberste Ebene des Kurses; mit „/“ lassen sich Unterkategorien bilden.');

  const scopeField = test
    ? h('div', { class: 'field' }, [h('div', { class: 'field-label' }, 'Umfang'), h('div', { class: 'banner info' }, `Test „${test.name}“ mit ${pluralize(testQs.length, 'Frage', 'Fragen')} in der Reihenfolge des Tests.`)])
    : h('div', { class: 'field' }, [
        h('div', { class: 'field-label' }, 'Umfang'),
        radio('scope', 'all', scope, `Alle ${pluralize(all.length, 'Frage', 'Fragen')}`, null, (v) => { scope = v; update(); }),
        radio('scope', 'selected', scope, `Nur ausgewählte (${selected.length})`, selected.length ? 'Die in der Liste angehakten Fragen.' : 'Hake Fragen in der Liste an, um eine Auswahl zu exportieren.', (v) => { scope = v; update(); }, !selected.length),
      ]);

  const body = h('div', {}, [
    h('div', { class: 'field' }, [
      h('div', { class: 'field-label' }, 'Format'),
      radio('fmt', 'xml', format, 'Moodle-XML (empfohlen)', 'Für den Import in die Moodle-Fragensammlung. Unterstützt alle Fragetypen.', (v) => { format = v; update(); }),
      radio('fmt', 'gift', format, 'GIFT', 'Einfaches Textformat, ebenfalls von Moodle importierbar. Keine Lückentext-Fragen.', (v) => { format = v; update(); }),
      radio('fmt', 'json', format, 'Sicherung (JSON)', 'Zum Aufbewahren oder zum Weiterbearbeiten auf einem anderen Gerät. Nur für dieses Tool.', (v) => { format = v; update(); }),
    ]),
    scopeField,
    categoryField,
    skipField,
    field('Dateiname', filenameInput),
    summary,
  ]);
  update();

  openModal({
    title: test ? `Test „${test.name}“ exportieren` : 'Exportieren',
    body,
    actions: [
      { label: 'Abbrechen', onClick: (c) => c() },
      {
        label: 'Herunterladen', class: 'primary',
        onClick: (close) => {
          let list = currentList();
          const base = (filenameInput.value.trim() || slugify(cat.name)).replace(/\.(xml|txt|gift|json)$/i, '');
          const category = categoryInput.value.trim();
          if (format === 'json') {
            download(base + '.json', store.makeBackup([{ ...cat, questions: list, tests: test ? [test] : cat.tests }]), 'application/json');
          } else {
            if (opts.skipInvalid) list = list.filter((q) => !validateQuestion(q).length);
            if (!list.length) return toast('Keine exportfähigen Fragen.', 'error');
            if (format === 'xml') {
              download(base + '.xml', exportMoodleXml(list, { category }), 'application/xml');
            } else {
              const { text, skipped } = exportGift(list, { category });
              if (skipped.length === list.length) return toast('Keine Frage konnte als GIFT exportiert werden.', 'error');
              download(base + '.gift.txt', text, 'text/plain');
            }
          }
          close();
          toast('Datei wurde heruntergeladen.', 'success');
        },
      },
    ],
  });
}

// ---------- Import ----------
function openImport() {
  const fileInput = h('input', { type: 'file', accept: '.xml,.json,application/xml,text/xml,application/json', style: { display: 'none' } });
  const zone = h('div', { class: 'dropzone', onclick: () => fileInput.click() }, [
    h('div', { style: { fontSize: '1.6rem' } }, '📂'),
    h('div', {}, h('strong', {}, 'Datei hier ablegen oder klicken')),
    h('div', { class: 'small' }, 'Moodle-XML (.xml) oder Sicherung dieses Tools (.json)'),
  ]);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); });
  fileInput.addEventListener('change', () => fileInput.files?.[0] && handleFile(fileInput.files[0]));
  const result = h('div', {});
  const body = h('div', {}, [zone, fileInput, result]);
  const close = openModal({ title: 'Importieren', body });

  async function handleFile(file) {
    let text;
    try { text = await file.text(); } catch { return toast('Datei konnte nicht gelesen werden.', 'error'); }
    result.innerHTML = '';
    try {
      if (/^\s*[\[{]/.test(text)) {
        const catalogs = store.parseBackup(text);
        const n = catalogs.reduce((s, c) => s + c.questions.length, 0);
        result.appendChild(h('div', { class: 'banner info', style: { marginTop: '1rem' } }, `Sicherung mit ${pluralize(catalogs.length, 'Katalog', 'Katalogen')} und ${pluralize(n, 'Frage', 'Fragen')}: ${catalogs.map((c) => c.name).join(', ')}`));
        result.appendChild(h('div', { class: 'modal-foot', style: { padding: '0.75rem 0 0', border: 'none' } }, [
          h('button', { class: 'btn', onclick: () => { mergeInto(catalog(), catalogs.flatMap((c) => c.questions)); close(); } }, 'In aktuellen Katalog einfügen'),
          h('button', { class: 'btn primary', onclick: () => { state.catalogs.push(...catalogs); switchCatalog(catalogs[0].id); close(); toast(`${pluralize(catalogs.length, 'Katalog', 'Kataloge')} wiederhergestellt.`, 'success'); } }, 'Als neue Kataloge anlegen'),
        ]));
      } else {
        const { questions: imported, category, skipped } = importMoodleXml(text);
        if (!imported.length && !skipped.length) throw new Error('Die Datei enthält keine Fragen.');
        result.appendChild(h('div', { class: 'banner info', style: { marginTop: '1rem' } }, [
          h('div', {}, `${pluralize(imported.length, 'Frage', 'Fragen')} gefunden${category ? ` (Kategorie „${category}“)` : ''}.`),
          skipped.length ? h('div', {}, [`Nicht unterstützt und übersprungen: `, h('ul', {}, skipped.map((s) => h('li', {}, s)))]) : null,
        ]));
        if (imported.length) {
          const name = (category || file.name.replace(/\.xml$/i, '')).split('/').filter((s) => s && !/^\$?(course|system)\$?$|^top$/i.test(s)).pop() || file.name;
          result.appendChild(h('div', { class: 'modal-foot', style: { padding: '0.75rem 0 0', border: 'none' } }, [
            h('button', { class: 'btn', onclick: () => { mergeInto(catalog(), imported); close(); } }, 'In aktuellen Katalog einfügen'),
            h('button', { class: 'btn primary', onclick: () => {
              const c = store.newCatalog(name);
              if (category) c.category = category;
              c.questions = imported;
              state.catalogs.push(c);
              switchCatalog(c.id);
              close();
              toast(`Katalog „${name}“ mit ${pluralize(imported.length, 'Frage', 'Fragen')} angelegt.`, 'success');
            } }, 'Als neuen Katalog anlegen'),
          ]));
        }
      }
    } catch (err) {
      result.appendChild(h('div', { class: 'banner warn', style: { marginTop: '1rem' } }, 'Import fehlgeschlagen: ' + (err.message || err)));
    }
  }
}

function mergeInto(cat, imported) {
  const list = imported.map((q) => normalizeQuestion({ ...q, id: uid() }));
  cat.questions.push(...list);
  ui.selectedId = list[0]?.id ?? ui.selectedId;
  touch();
  renderAll();
  toast(`${pluralize(list.length, 'Frage', 'Fragen')} eingefügt.`, 'success');
}

// ---------- Kataloge ----------
function openCatalogSettings() {
  const cat = catalog();
  const nameInput = textInput(cat, 'name', {}, { onChange: () => renderHeader() });
  const categoryInput = textInput(cat, 'category', {});
  const types = {};
  cat.questions.forEach((q) => (types[q.type] = (types[q.type] || 0) + 1));
  const invalid = cat.questions.filter((q) => validateQuestion(q).length).length;
  const body = h('div', {}, [
    h('div', { class: 'stats' }, [
      h('div', { class: 'stat' }, [h('b', {}, String(cat.questions.length)), h('span', {}, 'Fragen')]),
      h('div', { class: 'stat' }, [h('b', {}, String(cat.questions.length - invalid)), h('span', {}, 'exportfähig')]),
      h('div', { class: 'stat' }, [h('b', {}, String(cat.questions.reduce((s, q) => s + (Number(q.defaultGrade) || 0), 0))), h('span', {}, 'Punkte gesamt')]),
      h('div', { class: 'stat' }, [h('b', {}, formatDate(cat.updatedAt)), h('span', {}, 'zuletzt geändert')]),
    ]),
    field('Name des Katalogs', nameInput),
    field('Kategorie in Moodle', categoryInput, 'Pfad der Fragenkategorie beim Import, z. B. <code>$course$/top/Kapitel 1</code>.'),
    Object.keys(types).length ? h('div', { class: 'small muted' }, 'Fragetypen: ' + Object.entries(types).map(([t, n]) => `${TYPES[t]?.label || t} (${n})`).join(', ')) : null,
  ]);
  openModal({
    title: 'Katalog-Einstellungen',
    body,
    actions: [
      { label: 'Katalog löschen', class: 'danger', left: true, onClick: async (close) => {
        if (!(await confirmDialog(`Katalog „${cat.name}“ mit ${pluralize(cat.questions.length, 'Frage', 'Fragen')} endgültig löschen? Lade vorher ggf. eine Sicherung herunter.`, { okLabel: 'Endgültig löschen', danger: true, title: 'Katalog löschen' }))) return;
        state.catalogs = state.catalogs.filter((c) => c.id !== cat.id);
        if (!state.catalogs.length) state.catalogs.push(store.newCatalog());
        close();
        switchCatalog(state.catalogs[0].id);
        toast('Katalog gelöscht.');
      } },
      { label: 'Sicherung herunterladen', onClick: () => { download(slugify(cat.name) + '.json', store.makeBackup([cat]), 'application/json'); toast('Sicherung heruntergeladen.', 'success'); } },
      { label: 'Fertig', class: 'primary', onClick: (close) => { close(); renderHeader(); } },
    ],
  });
}

async function newCatalog() {
  const name = await promptDialog('Neuer Katalog', 'Name (z. B. Kursname oder Thema)', 'Neuer Katalog');
  if (!name) return;
  const c = store.newCatalog(name);
  state.catalogs.push(c);
  switchCatalog(c.id);
  toast(`Katalog „${name}“ angelegt.`, 'success');
}

// ---------- Hilfe ----------
function openHelp() {
  const tpl = $('#help-template').content.cloneNode(true);
  openModal({ title: 'Hilfe', body: tpl, wide: true, actions: [{ label: 'Schließen', class: 'primary', onClick: (c) => c() }] });
}

function openTypeChooser() {
  let close;
  close = openModal({ title: 'Neue Frage – Typ wählen', body: typeGrid((t) => { close(); addQuestion(t); }), wide: true });
}

// ---------- Tests (gespeicherte Fragen-Sets) ----------
function tests() {
  const c = catalog();
  if (!Array.isArray(c.tests)) c.tests = [];
  return c.tests;
}
function selectedTest() {
  return tests().find((t) => t.id === ui.selectedTestId) || null;
}
function testQuestions(t) {
  const byId = new Map(questions().map((q) => [q.id, q]));
  return t.questionIds.map((id) => byId.get(id)).filter(Boolean);
}
function testPoints(t) {
  return testQuestions(t).reduce((s, q) => s + (q.type === 'description' ? 0 : Number(q.defaultGrade) || 0), 0);
}
function formatPoints(n) {
  return String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',');
}

function newTest(name, questionIds = []) {
  const t = { id: uid(), name, description: '', questionIds: [...new Set(questionIds)], createdAt: Date.now() };
  tests().push(t);
  ui.selectedTestId = t.id;
  ui.tab = 'tests';
  touch();
  renderAll();
  return t;
}

async function createTestDialog(questionIds = []) {
  const name = await promptDialog('Neuer Test', 'Name des Tests', `Test ${tests().length + 1}`);
  if (!name) return null;
  const t = newTest(name, questionIds);
  toast(`Test „${name}“ angelegt${questionIds.length ? ` mit ${pluralize(questionIds.length, 'Frage', 'Fragen')}` : ''}.`, 'success');
  return t;
}

async function deleteTest(t) {
  if (!(await confirmDialog(`Test „${t.name}“ löschen? Die Fragen selbst bleiben im Katalog erhalten.`, { okLabel: 'Löschen', danger: true, title: 'Test löschen' }))) return;
  catalog().tests = tests().filter((x) => x.id !== t.id);
  ui.selectedTestId = null;
  touch();
  renderAll();
  toast('Test gelöscht.');
}

function moveInTest(t, idx, delta) {
  const to = idx + delta;
  if (to < 0 || to >= t.questionIds.length) return;
  const [id] = t.questionIds.splice(idx, 1);
  t.questionIds.splice(to, 0, id);
  touch();
}

function renderSidebar() {
  document.querySelectorAll('.sidebar-tabs .tab').forEach((b) => {
    const active = b.dataset.tab === ui.tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('#questions-panel').hidden = ui.tab !== 'questions';
  $('#tests-panel').hidden = ui.tab !== 'tests';
  if (ui.tab === 'questions') renderList();
  else renderTestList();
}

function renderTestList() {
  const list = $('#test-list');
  list.innerHTML = '';
  const ts = tests();
  if (!ts.length) list.appendChild(h('li', { class: 'list-empty' }, 'Noch keine Tests. Lege einen Test an und füge Fragen aus dem Katalog hinzu.'));
  ts.forEach((t) => {
    const qs = testQuestions(t);
    list.appendChild(
      h('li', { class: 'q-item' + (t.id === ui.selectedTestId ? ' selected' : ''), onclick: () => { ui.selectedTestId = t.id; renderSidebar(); renderEditor(); } }, [
        h('span', { class: 'q-badge' }, 'TEST'),
        h('span', { class: 'q-title' }, t.name),
        h('span', { class: 'muted small', style: { whiteSpace: 'nowrap' } }, `${qs.length} · ${formatPoints(testPoints(t))} P.`),
      ]),
    );
  });
}

function renderTestEditor(root) {
  const t = selectedTest();
  if (!t) {
    root.appendChild(h('div', { class: 'empty-state' }, [
      h('h2', {}, tests().length ? 'Test auswählen oder neuen Test anlegen' : 'Tests zusammenstellen'),
      h('p', {}, 'Ein Test ist eine gespeicherte Auswahl und Reihenfolge von Fragen aus diesem Katalog. Du kannst ihn als Moodle-XML exportieren oder als Papierversion drucken – wahlweise mit Lösungsblatt.'),
      h('button', { class: 'btn primary', onclick: () => createTestDialog() }, '＋ Neuer Test'),
    ]));
    return;
  }
  const inner = h('div', { class: 'editor-inner' });
  const heading = h('h2', {}, t.name);
  const exportBtn = h('button', { class: 'btn small primary', onclick: () => openExport({ test: t }) }, 'Exportieren');
  const printBtn = h('button', { class: 'btn small', onclick: () => openPrintDialog(t) }, 'Drucken');
  inner.appendChild(h('div', { class: 'editor-head' }, [
    h('span', { class: 'type-pill' }, '📝 Test'),
    heading,
    h('span', { class: 'spacer' }),
    printBtn,
    exportBtn,
    h('button', { class: 'btn small danger', onclick: () => deleteTest(t) }, 'Löschen'),
  ]));
  inner.appendChild(h('div', { class: 'card' }, [
    h('h3', {}, 'Test'),
    field('Name', textInput(t, 'name', { placeholder: 'z. B. Klassenarbeit Kapitel 3' }, { onChange: () => { heading.textContent = t.name || 'Test'; renderTestList(); } }), 'Wird beim Export als Unterkategorie in Moodle und als Überschrift im Ausdruck verwendet.'),
    field('Hinweise für Teilnehmende', textArea(t, 'description', { rows: 3, placeholder: 'z. B. Bearbeitungszeit, erlaubte Hilfsmittel – erscheint im Ausdruck' }), null, { optional: true }),
  ]));

  const summaryText = () => `${pluralize(testQuestions(t).length, 'Frage', 'Fragen')} · ${formatPoints(testPoints(t))} Punkte gesamt`;
  const summary = h('span', { class: 'muted' }, summaryText());
  const warnBox = h('div', {});
  const listEl = h('div', { class: 'answers' });
  const refresh = () => {
    const cur = testQuestions(t);
    listEl.innerHTML = '';
    cur.forEach((q, i) => {
      const problems = validateQuestion(q);
      listEl.appendChild(h('div', { class: 'test-q-row' }, [
        h('span', { class: 'q-num' }, String(i + 1)),
        h('span', { class: 'q-badge', title: TYPES[q.type].label }, TYPES[q.type].short),
        h('a', { class: 'q-title' + (q.name ? '' : ' empty'), href: '#', title: 'Frage bearbeiten', onclick: (e) => { e.preventDefault(); ui.tab = 'questions'; ui.selectedId = q.id; renderAll(); } }, q.name || 'Ohne Titel'),
        h('span', { class: 'q-warn', title: problems.join('\n') }, problems.length ? '!' : ''),
        h('span', { class: 'muted small' }, q.type === 'description' ? '–' : formatPoints(q.defaultGrade) + ' P.'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { moveInTest(t, i, -1); refresh(); }, disabled: i === 0, title: 'Nach oben' }, '↑'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { moveInTest(t, i, 1); refresh(); }, disabled: i === cur.length - 1, title: 'Nach unten' }, '↓'),
        removeButton(() => { t.questionIds = t.questionIds.filter((id) => id !== q.id); touch(); refresh(); }),
      ]));
    });
    if (!cur.length) listEl.appendChild(h('div', { class: 'list-empty' }, 'Noch keine Fragen im Test.'));
    const invalid = cur.filter((q) => validateQuestion(q).length).length;
    warnBox.innerHTML = '';
    if (invalid) warnBox.appendChild(h('div', { class: 'banner warn' }, `Unvollständige Fragen im Test: ${invalid} (mit „!“ markiert). Sie werden beim Export übersprungen.`));
    summary.textContent = summaryText();
    exportBtn.disabled = printBtn.disabled = !cur.length;
    renderTestList();
  };
  refresh();
  inner.appendChild(h('div', { class: 'card' }, [
    h('h3', {}, ['Fragen in diesem Test', summary]),
    warnBox,
    listEl,
    h('button', { class: 'btn small', type: 'button', onclick: () => openAddQuestionsDialog(t, refresh) }, '＋ Fragen hinzufügen'),
    h('div', { class: 'hint' }, 'Die Reihenfolge gilt für den Ausdruck. In Moodle stellst du den Test nach dem Import aus den Fragen der Kategorie zusammen.'),
  ]));
  root.appendChild(inner);
}

function openAddQuestionsDialog(t, done) {
  const available = questions().filter((q) => !t.questionIds.includes(q.id));
  if (!available.length) return toast(questions().length ? 'Alle Fragen des Katalogs sind bereits im Test.' : 'Der Katalog enthält noch keine Fragen.');
  const picked = new Set();
  const search = h('input', { type: 'search', placeholder: 'Fragen durchsuchen …' });
  const listEl = h('div', { class: 'pick-list' });
  let addBtn = null;
  const syncBtn = () => { if (addBtn) { addBtn.textContent = `Hinzufügen (${picked.size})`; addBtn.disabled = !picked.size; } };
  const rebuild = () => {
    const s = search.value.trim().toLowerCase();
    listEl.innerHTML = '';
    available
      .filter((q) => !s || (q.name + ' ' + stripHtml(q.text)).toLowerCase().includes(s))
      .forEach((q) => {
        const cb = h('input', { type: 'checkbox', checked: picked.has(q.id) });
        cb.addEventListener('change', () => { cb.checked ? picked.add(q.id) : picked.delete(q.id); syncBtn(); });
        listEl.appendChild(h('label', { class: 'pick-row' }, [
          cb,
          h('span', { class: 'q-badge', title: TYPES[q.type].label }, TYPES[q.type].short),
          h('span', { class: 'q-title' + (q.name ? '' : ' empty') }, q.name || 'Ohne Titel'),
          h('span', { class: 'muted small' }, stripHtml(q.text).slice(0, 80)),
        ]));
      });
    if (!listEl.children.length) listEl.appendChild(h('div', { class: 'list-empty' }, 'Keine Treffer.'));
  };
  search.addEventListener('input', rebuild);
  rebuild();
  const selectAll = h('button', { class: 'btn', type: 'button', onclick: () => { available.forEach((q) => picked.add(q.id)); rebuild(); syncBtn(); } }, 'Alle');
  openModal({
    title: `Fragen zu „${t.name}“ hinzufügen`,
    wide: true,
    body: h('div', {}, [h('div', { class: 'pick-head' }, [search, selectAll]), listEl]),
    actions: [
      { label: 'Abbrechen', onClick: (c) => c() },
      { label: 'Hinzufügen (0)', class: 'primary', disabled: true, onClick: (c) => {
        const ids = available.filter((q) => picked.has(q.id)).map((q) => q.id);
        t.questionIds.push(...ids);
        touch();
        c();
        done();
        toast(`${pluralize(ids.length, 'Frage', 'Fragen')} hinzugefügt.`, 'success');
      } },
    ],
  });
  addBtn = $('#modal-root .modal-foot button.primary');
  search.focus();
}

async function addCheckedToTest() {
  const ids = questions().filter((q) => ui.checked.has(q.id)).map((q) => q.id);
  if (!ids.length) return;
  const ts = tests();
  if (!ts.length) {
    if (await createTestDialog(ids)) ui.checked.clear();
    return;
  }
  const sel = h('select', {}, [...ts.map((t) => h('option', { value: t.id }, t.name)), h('option', { value: '__new' }, '＋ Neuer Test …')]);
  openModal({
    title: `${pluralize(ids.length, 'Frage', 'Fragen')} in Test übernehmen`,
    body: field('Test', sel),
    actions: [
      { label: 'Abbrechen', onClick: (c) => c() },
      { label: 'Übernehmen', class: 'primary', onClick: async (c) => {
        c();
        if (sel.value === '__new') {
          if (await createTestDialog(ids)) ui.checked.clear();
          return;
        }
        const t = ts.find((x) => x.id === sel.value);
        const added = ids.filter((id) => !t.questionIds.includes(id));
        t.questionIds.push(...added);
        ui.checked.clear();
        ui.selectedTestId = t.id;
        ui.tab = 'tests';
        touch();
        renderAll();
        toast(added.length ? `${pluralize(added.length, 'Frage', 'Fragen')} zu „${t.name}“ hinzugefügt.` : 'Diese Fragen sind bereits im Test.', added.length ? 'success' : '');
      } },
    ],
  });
}

// ---------- Drucken ----------
function openPrintDialog(t) {
  const o = { nameField: true, points: true, solutions: true };
  const cb = (key, label) => {
    const i = h('input', { type: 'checkbox', checked: o[key] });
    i.addEventListener('change', () => (o[key] = i.checked));
    return h('label', { class: 'check', style: { display: 'flex', marginBottom: '0.6rem' } }, [i, h('span', {}, label)]);
  };
  openModal({
    title: 'Papierversion drucken',
    body: h('div', {}, [
      h('p', {}, 'Öffnet eine Druckansicht in einem neuen Tab. Dort kannst du drucken oder als PDF speichern.'),
      cb('nameField', 'Felder für Name und Datum'),
      cb('points', 'Punkte je Frage anzeigen'),
      cb('solutions', 'Lösungsblatt anhängen (auf eigener Seite)'),
    ]),
    actions: [
      { label: 'Abbrechen', onClick: (c) => c() },
      { label: 'Druckansicht öffnen', class: 'primary', onClick: (c) => { c(); printTest(t, o); } },
    ],
  });
}

function printTest(t, o) {
  const win = window.open('', '_blank');
  if (!win) return toast('Der Browser hat das neue Fenster blockiert. Bitte Pop-ups für diese Seite erlauben.', 'error');
  win.document.open();
  win.document.write(printHtml(t, testQuestions(t), o));
  win.document.close();
}

function answerLabel(style, i) {
  if (style === 'none') return '';
  if (style === 'abc') return String.fromCharCode(97 + i) + ') ';
  if (style === 'ABCD') return String.fromCharCode(65 + i) + ') ';
  if (style === '123') return i + 1 + ') ';
  const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][i] || String(i + 1);
  return (style === 'IIII' ? roman.toUpperCase() : roman) + ') ';
}

const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.45; color: #111; max-width: 180mm; margin: 0 auto; padding: 12mm 0; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 18px; }
  h1 { font-size: 20pt; margin: 0 0 4px; }
  .meta { color: #444; font-size: 10.5pt; }
  .desc { margin-top: 8px; }
  .namefield { display: flex; justify-content: space-between; gap: 16px; margin-top: 14px; font-size: 11pt; }
  section.q { margin: 0 0 18px; page-break-inside: avoid; break-inside: avoid; }
  .qhead { display: flex; justify-content: space-between; font-weight: bold; }
  .pts { font-weight: normal; color: #444; font-size: 10.5pt; }
  .qtext p { margin: 2px 0 6px; }
  ul.opts { list-style: none; padding: 0; margin: 4px 0 0; }
  ul.opts li { margin: 3px 0; display: flex; gap: 8px; align-items: baseline; }
  ul.opts.inline { display: flex; gap: 28px; }
  .box { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #111; border-radius: 2px; flex: none; position: relative; top: 1px; }
  .line { border-bottom: 1px solid #111; height: 22px; margin-top: 8px; }
  .line.short { width: 40%; }
  .lines { margin-top: 8px; background: repeating-linear-gradient(to bottom, transparent 0, transparent 23px, #999 23px, #999 24px); }
  .gap { display: inline-block; min-width: 90px; border-bottom: 1px solid #111; }
  table.match { border-collapse: collapse; margin-top: 6px; }
  table.match td { padding: 4px 10px 4px 0; vertical-align: top; }
  table.match td.blank { width: 130px; border-bottom: 1px solid #111; }
  .choices { margin-top: 6px; font-size: 11pt; color: #333; }
  .solutions { page-break-before: always; break-before: page; }
  .solutions h2 { font-size: 16pt; border-bottom: 2px solid #111; padding-bottom: 6px; }
  .solutions li { margin-bottom: 6px; }
  .solutions .qn { color: #666; font-size: 10.5pt; }
  .hint { color: #555; font-style: italic; font-size: 10.5pt; }
  img { max-width: 100%; }
  @media print { body { padding: 0; } }
`;

function printHtml(t, qs, o) {
  const cat = catalog();
  let n = 0;
  const blocks = qs.map((q) => {
    const isDesc = q.type === 'description';
    if (!isDesc) n++;
    const pts = !isDesc && o.points ? `<span class="pts">${formatPoints(q.defaultGrade)} ${Number(q.defaultGrade) === 1 ? 'Punkt' : 'Punkte'}</span>` : '';
    const head = isDesc ? '' : `<div class="qhead"><span>Aufgabe ${n}</span>${pts}</div>`;
    const text = q.type === 'cloze' ? printCloze(q.text) : textToHtml(q.text);
    return `<section class="q">${head}<div class="qtext">${text}</div>${printBody(q)}</section>`;
  });
  const solutions = o.solutions
    ? `<section class="solutions"><h2>Lösungen – ${escapeHtml(t.name)}</h2><ol>${qs.filter((q) => q.type !== 'description').map((q) => `<li>${solutionHtml(q)}</li>`).join('')}</ol></section>`
    : '';
  const meta = [escapeHtml(cat.name), pluralize(n, 'Aufgabe', 'Aufgaben'), o.points ? `${formatPoints(testPoints(t))} Punkte` : ''].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(t.name)}</title><style>${PRINT_CSS}</style></head><body>
<header><h1>${escapeHtml(t.name)}</h1><div class="meta">${meta}</div>${t.description ? `<div class="desc">${textToHtml(t.description)}</div>` : ''}${o.nameField ? '<div class="namefield"><span>Name: ________________________________</span><span>Datum: ________________</span></div>' : ''}</header>
${blocks.join('\n')}
${solutions}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });</script>
</body></html>`;
}

function printCloze(text) {
  return textToHtml(text).replace(/\{\d*:[A-Z_]+:[^}]*\}/g, '<span class="gap">&nbsp;</span>');
}

function inline(html) {
  return textToHtml(html).replace(/^<p>|<\/p>$/g, '').replace(/<\/p>\s*<p>/g, '<br>');
}

function printBody(q) {
  switch (q.type) {
    case 'multichoice': {
      const answers = q.answers.filter((a) => a.text.trim());
      return (q.single ? '' : '<div class="hint">Mehrere Antworten können richtig sein.</div>') +
        `<ul class="opts">${answers.map((a, i) => `<li><span class="box"></span><span>${answerLabel(q.numbering, i)}${inline(a.text)}</span></li>`).join('')}</ul>`;
    }
    case 'truefalse':
      return '<ul class="opts inline"><li><span class="box"></span> Wahr</li><li><span class="box"></span> Falsch</li></ul>';
    case 'shortanswer':
      return '<div class="line"></div>';
    case 'numerical':
      return '<div class="line short"></div>';
    case 'matching': {
      const pairs = q.pairs.filter((p) => stripHtml(p.question));
      const choices = [...new Set(q.pairs.map((p) => p.answer.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
      return `<table class="match">${pairs.map((p) => `<tr><td>${inline(p.question)}</td><td class="blank"></td></tr>`).join('')}</table>` +
        `<div class="choices">Auswahl: ${choices.map((c, i) => `${String.fromCharCode(65 + i)}) ${escapeHtml(c)}`).join(' &nbsp; ')}</div>`;
    }
    case 'essay': {
      const lines = Math.min(Math.max(Number(q.responseFieldLines) || 10, 4), 30);
      return `<div class="lines" style="height:${lines * 24}px"></div>`;
    }
    default:
      return '';
  }
}

function solutionHtml(q) {
  const title = `<span class="qn">${escapeHtml(q.name || '')}</span> `;
  switch (q.type) {
    case 'multichoice': {
      const answers = q.answers.filter((a) => a.text.trim());
      const fr = multichoiceFractions({ ...q, answers });
      return title + answers.map((a, i) => (fr[i] > 0 ? `${answerLabel(q.numbering, i)}${inline(a.text)}` : null)).filter(Boolean).join(', ');
    }
    case 'truefalse':
      return title + (q.correctAnswer === false ? 'Falsch' : 'Wahr');
    case 'shortanswer': {
      const full = q.answers.filter((a) => a.text.trim() && Number(a.fraction) === 100).map((a) => escapeHtml(a.text));
      const partial = q.answers.filter((a) => a.text.trim() && Number(a.fraction) > 0 && Number(a.fraction) < 100).map((a) => `${escapeHtml(a.text)} (${formatFraction(a.fraction)} %)`);
      return title + full.join(' / ') + (partial.length ? ` <span class="hint">teilweise: ${partial.join(', ')}</span>` : '');
    }
    case 'numerical':
      return title + q.answers.filter((a) => String(a.text).trim() && Number(a.fraction) > 0).map((a) => `${escapeHtml(a.text)}${Number(a.tolerance) ? ' ± ' + escapeHtml(String(a.tolerance)) : ''}`).join(' / ');
    case 'matching': {
      const choices = [...new Set(q.pairs.map((p) => p.answer.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
      return title + q.pairs.filter((p) => stripHtml(p.question)).map((p) => `${inline(p.question)} → ${String.fromCharCode(65 + choices.indexOf(p.answer.trim()))} (${escapeHtml(p.answer.trim())})`).join('; ');
    }
    case 'essay':
      return title + (q.graderInfo ? inline(q.graderInfo) : '<span class="hint">Freitext – manuelle Bewertung</span>');
    case 'cloze': {
      const gaps = [];
      String(q.text || '').replace(/\{\d*:[A-Z_]+:([^}]*)\}/g, (m, body) => {
        const best = body.split('~').map((s) => s.trim()).filter((s) => s.startsWith('=') || s.startsWith('%100%'))[0] || body.split('~')[0];
        gaps.push(escapeHtml(best.replace(/^(=|%100%)/, '').replace(/#.*$/, '').trim()));
        return m;
      });
      return title + gaps.map((g, i) => `Lücke ${i + 1}: ${g}`).join('; ');
    }
    default:
      return title;
  }
}

// ---------- Start ----------
function renderAll() {
  renderHeader();
  renderSidebar();
  renderEditor();
}

function init() {
  if (!store.storageAvailable()) {
    toast('Achtung: Der Browser-Speicher ist nicht verfügbar. Änderungen gehen beim Schließen verloren – bitte regelmäßig eine Sicherung herunterladen.', 'error');
  }
  $('#catalog-select').addEventListener('change', (e) => switchCatalog(e.target.value));
  $('#btn-catalog-settings').addEventListener('click', openCatalogSettings);
  $('#btn-catalog-new').addEventListener('click', newCatalog);
  $('#btn-import').addEventListener('click', openImport);
  $('#btn-export').addEventListener('click', openExport);
  $('#btn-help').addEventListener('click', openHelp);
  $('#btn-new').addEventListener('click', openTypeChooser);
  $('#btn-new-test').addEventListener('click', () => createTestDialog());
  $('#btn-add-to-test').addEventListener('click', addCheckedToTest);
  document.querySelectorAll('.sidebar-tabs .tab').forEach((b) => b.addEventListener('click', () => {
    ui.tab = b.dataset.tab;
    renderAll();
  }));
  $('#search').addEventListener('input', (e) => { ui.search = e.target.value; renderList(); });
  $('#check-all').addEventListener('change', (e) => {
    ui.checked.clear();
    if (e.target.checked) questions().forEach((q) => ui.checked.add(q.id));
    renderList();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      persist.flush();
      setStatus(store.save(state) ? 'saved' : 'error');
      toast('Gespeichert – alles liegt im Browser-Speicher. Für eine Datei: „Exportieren“.');
    }
  });
  window.addEventListener('storage', (e) => {
    // Änderungen aus einem anderen Tab übernehmen
    if (e.key && e.key.includes('moodle-question-designer')) {
      state = store.load();
      if (!state.catalogs.some((c) => c.id === state.activeId)) state.activeId = state.catalogs[0].id;
      renderAll();
    }
  });
  if (!ui.selectedId && questions().length) ui.selectedId = questions()[0].id;
  renderAll();
}

init();
