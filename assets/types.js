// Fragetypen, Standardwerte und Validierung.
import { uid, stripHtml } from './util.js';

export const TYPE_ORDER = [
  'multichoice',
  'truefalse',
  'shortanswer',
  'numerical',
  'matching',
  'essay',
  'cloze',
  'description',
];

export const TYPES = {
  multichoice: {
    label: 'Multiple Choice',
    short: 'MC',
    icon: '☑',
    desc: 'Eine oder mehrere richtige Antworten aus einer Liste auswählen.',
    penalty: 0.3333333,
  },
  truefalse: {
    label: 'Wahr / Falsch',
    short: 'W/F',
    icon: '✓✗',
    desc: 'Eine Aussage, die wahr oder falsch ist.',
    penalty: 1,
  },
  shortanswer: {
    label: 'Kurzantwort',
    short: 'KA',
    icon: 'Aa',
    desc: 'Ein Wort oder ein kurzer Satz wird eingetippt und mit Musterlösungen verglichen.',
    penalty: 0.3333333,
  },
  numerical: {
    label: 'Numerisch',
    short: '123',
    icon: '#',
    desc: 'Eine Zahl wird eingegeben, optional mit Toleranz.',
    penalty: 0.3333333,
  },
  matching: {
    label: 'Zuordnung',
    short: 'ZU',
    icon: '⇄',
    desc: 'Begriffe werden passenden Antworten aus einer Liste zugeordnet.',
    penalty: 0.3333333,
  },
  essay: {
    label: 'Freitext',
    short: 'FT',
    icon: '✎',
    desc: 'Längere Antwort, die von Hand bewertet wird.',
    penalty: 0,
  },
  cloze: {
    label: 'Lückentext (Cloze)',
    short: 'LT',
    icon: '▁',
    desc: 'Text mit eingebetteten Lücken (Moodle-Cloze-Syntax).',
    penalty: 0.3333333,
  },
  description: {
    label: 'Beschreibung',
    short: 'TXT',
    icon: '¶',
    desc: 'Nur Text, keine Frage – z. B. eine Einleitung oder Anweisung.',
    penalty: 0,
  },
};

export function newAnswer(extra = {}) {
  return { id: uid(), text: '', correct: false, fraction: 0, feedback: '', tolerance: 0, ...extra };
}

export function newPair(extra = {}) {
  return { id: uid(), question: "", answer: "", ...extra };
}

export function createQuestion(type) {
  const base = {
    id: uid(),
    type,
    name: '',
    text: '',
    generalFeedback: '',
    defaultGrade: 1,
    penalty: TYPES[type]?.penalty ?? 0,
    tags: '',
    createdAt: Date.now(),
  };
  switch (type) {
    case 'multichoice':
      return {
        ...base,
        single: true,
        shuffle: true,
        numbering: 'abc',
        autoFractions: true,
        answers: [newAnswer({ correct: true }), newAnswer(), newAnswer()],
        correctFeedback: 'Die Antwort ist richtig.',
        partialFeedback: 'Die Antwort ist teilweise richtig.',
        incorrectFeedback: 'Die Antwort ist falsch.',
      };
    case 'truefalse':
      return { ...base, correctAnswer: true, feedbackTrue: '', feedbackFalse: '' };
    case 'shortanswer':
      return { ...base, usecase: false, answers: [newAnswer({ fraction: 100 })] };
    case 'numerical':
      return { ...base, answers: [newAnswer({ fraction: 100, tolerance: 0 })] };
    case 'matching':
      return {
        ...base,
        shuffle: true,
        pairs: [newPair(), newPair(), newPair()],
        correctFeedback: 'Die Antwort ist richtig.',
        partialFeedback: 'Die Antwort ist teilweise richtig.',
        incorrectFeedback: 'Die Antwort ist falsch.',
      };
    case 'essay':
      return {
        ...base,
        responseFormat: 'editor',
        responseRequired: true,
        responseFieldLines: 15,
        attachments: 0,
        attachmentsRequired: 0,
        graderInfo: '',
        responseTemplate: '',
      };
    case 'cloze':
      return { ...base };
    case 'description':
      return { ...base, defaultGrade: 0 };
    default:
      return base;
  }
}

/** Fehlende Felder ergänzen (z. B. nach Import älterer Sicherungen). */
export function normalizeQuestion(q) {
  const fresh = createQuestion(TYPES[q.type] ? q.type : 'description');
  const merged = { ...fresh, ...q };
  if (Array.isArray(merged.answers)) merged.answers = merged.answers.map((a) => ({ ...newAnswer(), ...a }));
  if (Array.isArray(merged.pairs)) merged.pairs = merged.pairs.map((p) => ({ ...newPair(), ...p }));
  return merged;
}

/**
 * Berechnet die Prozentwerte der Multiple-Choice-Antworten.
 * Automatik: richtige Antworten teilen sich 100 %, falsche erhalten den negativen Anteil.
 */
export function multichoiceFractions(q) {
  const answers = q.answers || [];
  if (!q.autoFractions) return answers.map((a) => Number(a.fraction) || 0);
  if (q.single) return answers.map((a) => (a.correct ? 100 : 0));
  const nCorrect = answers.filter((a) => a.correct).length || 1;
  const share = 100 / nCorrect;
  return answers.map((a) => (a.correct ? share : -share));
}

export const FRACTION_OPTIONS = [
  100, 90, 83.33333, 80, 75, 70, 66.66667, 60, 50, 40, 33.33333, 30, 25, 20, 16.66667, 14.28571, 12.5, 11.11111, 10, 5, 0,
  -5, -10, -11.11111, -12.5, -14.28571, -16.66667, -20, -25, -30, -33.33333, -40, -50, -60, -66.66667, -70, -75, -80,
  -83.33333, -90, -100,
];

export const PENALTY_OPTIONS = [
  { value: 0, label: '0 % (kein Abzug)' },
  { value: 0.1, label: '10 %' },
  { value: 0.2, label: '20 %' },
  { value: 0.25, label: '25 %' },
  { value: 0.3333333, label: '33,3 %' },
  { value: 0.5, label: '50 %' },
  { value: 1, label: '100 %' },
];

/** Liefert eine Liste von Problemen; leer = exportfähig. */
export function validateQuestion(q) {
  const problems = [];
  const hasText = (s) => stripHtml(s).length > 0 || /<img|<video|<audio|<iframe/i.test(s || '');
  if (!q.name?.trim()) problems.push('Titel fehlt.');
  if (!hasText(q.text)) problems.push('Fragetext fehlt.');

  switch (q.type) {
    case 'multichoice': {
      const filled = (q.answers || []).filter((a) => hasText(a.text));
      if (filled.length < 2) problems.push('Mindestens zwei Antwortmöglichkeiten mit Text nötig.');
      const correct = filled.filter((a) => a.correct);
      if (q.autoFractions || q.single) {
        if (correct.length === 0) problems.push('Keine Antwort ist als richtig markiert.');
        if (q.single && correct.length > 1) problems.push('Bei "nur eine Antwort" darf nur eine Antwort richtig sein.');
      } else {
        const sum = filled.reduce((s, a) => s + Math.max(0, Number(a.fraction) || 0), 0);
        if (Math.round(sum) !== 100) problems.push(`Die positiven Prozentwerte müssen zusammen 100 % ergeben (aktuell ${Math.round(sum)} %).`);
      }
      if (q.autoFractions && !q.single) {
        const nCorrect = correct.length;
        if (nCorrect > 0 && ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20].includes(nCorrect) && 100 % nCorrect !== 0) {
          problems.push('Diese Anzahl richtiger Antworten ergibt keine von Moodle akzeptierten Prozentwerte. Verteile die Punkte manuell.');
        }
      }
      break;
    }
    case 'shortanswer': {
      const filled = (q.answers || []).filter((a) => a.text?.trim());
      if (filled.length === 0) problems.push('Mindestens eine akzeptierte Antwort nötig.');
      else if (!filled.some((a) => Number(a.fraction) === 100)) problems.push('Mindestens eine Antwort muss 100 % ergeben.');
      break;
    }
    case 'numerical': {
      const filled = (q.answers || []).filter((a) => String(a.text ?? '').trim() !== '');
      if (filled.length === 0) problems.push('Mindestens eine Antwort nötig.');
      for (const a of filled) {
        if (a.text.trim() !== '*' && Number.isNaN(parseNumber(a.text))) problems.push(`"${a.text}" ist keine gültige Zahl.`);
      }
      if (filled.length && !filled.some((a) => Number(a.fraction) === 100)) problems.push('Mindestens eine Antwort muss 100 % ergeben.');
      break;
    }
    case 'matching': {
      const full = (q.pairs || []).filter((p) => hasText(p.question) && p.answer?.trim());
      const answersOnly = (q.pairs || []).filter((p) => !hasText(p.question) && p.answer?.trim());
      if (full.length < 2) problems.push('Mindestens zwei vollständige Paare (Frage + Antwort) nötig.');
      const distinct = new Set([...full, ...answersOnly].map((p) => p.answer.trim()));
      if (distinct.size < 2) problems.push('Mindestens zwei verschiedene Antworten nötig.');
      if ((q.pairs || []).some((p) => hasText(p.question) && !p.answer?.trim())) problems.push('Jede Frage braucht eine Antwort.');
      break;
    }
    case 'cloze': {
      if (!/\{[^{}]*:(MULTICHOICE|MC|MULTIRESPONSE|MR|SHORTANSWER|SA|MW|SHORTANSWER_C|SAC|MWC|NUMERICAL|NM|MULTICHOICE_V|MCV|MULTICHOICE_H|MCH|MULTIRESPONSE_H|MRH|MULTICHOICE_S|MCS|MULTICHOICE_VS|MCVS|MULTICHOICE_HS|MCHS|MULTIRESPONSE_S|MRS|MULTIRESPONSE_HS|MRHS):[^{}]*\}/.test(q.text || '')) {
        problems.push('Der Text enthält keine gültige Lücke, z. B. {1:SHORTANSWER:=Antwort}.');
      }
      break;
    }
    default:
      break;
  }
  if (q.type !== 'description') {
    const grade = Number(q.defaultGrade);
    if (Number.isNaN(grade) || grade < 0) problems.push('Punkte müssen eine Zahl ≥ 0 sein.');
  }
  return problems;
}

export function parseNumber(s) {
  const str = String(s ?? '').trim().replace(',', '.');
  if (str === '') return NaN;
  return Number(str);
}
