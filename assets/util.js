// Kleine Hilfsfunktionen ohne Abhängigkeiten.

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Enthält der Text HTML-Tags? */
export function looksLikeHtml(s) {
  return /<\/?[a-z][^>]*>/i.test(String(s ?? ''));
}

/**
 * Wandelt einfachen Text (Absätze durch Leerzeilen, Zeilenumbrüche) in HTML.
 * Enthält der Text bereits HTML, wird er unverändert übernommen.
 */
export function textToHtml(s) {
  const str = String(s ?? '').replace(/\r\n?/g, '\n').trim();
  if (!str) return '';
  if (looksLikeHtml(str)) return str;
  return str
    .split(/\n{2,}/)
    .map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>')
    .join('\n');
}

/**
 * Gegenstück zu textToHtml: einfaches HTML (nur <p>, <br>) zurück in Text.
 * Komplexeres HTML bleibt unverändert, damit nichts verloren geht.
 */
export function htmlToText(html) {
  const str = String(html ?? '').trim();
  if (!str) return '';
  const withoutSimple = str.replace(/<\/?(p|br)\b[^>]*>/gi, '');
  if (looksLikeHtml(withoutSimple)) return str; // andere Tags vorhanden → HTML behalten
  const text = str
    .replace(/\s*<br\s*\/?>\s*/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .trim();
  return decodeEntities(text);
}

export function decodeEntities(s) {
  const ta = document.createElement('textarea');
  ta.innerHTML = s;
  return ta.value;
}

export function stripHtml(s) {
  const div = document.createElement('div');
  div.innerHTML = String(s ?? '');
  return (div.textContent || '').trim();
}

export function download(filename, content, mime = 'application/octet-stream') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  wrapped.flush = (...args) => {
    if (t) {
      clearTimeout(t);
      t = null;
      fn(...args);
    }
  };
  return wrapped;
}

export function slugify(s) {
  return (
    String(s ?? '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'fragen'
  );
}

/** Prozentwert im Moodle-Format (max. 5 Nachkommastellen, ohne Nullen am Ende). */
export function formatFraction(n) {
  const num = Number(n) || 0;
  return String(Number(num.toFixed(5)));
}

export function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Minimaler DOM-Helfer: h('div', {class: 'x', onclick: fn}, [children])
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}
