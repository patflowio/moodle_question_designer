// Import bestehender Moodle-XML-Dateien (z. B. aus einer Moodle-Fragensammlung exportiert).
import { htmlToText } from './util.js';
import { createQuestion, newAnswer, newPair } from './types.js';

function textOf(parent, selector) {
  if (!parent) return '';
  const node = selector ? parent.querySelector(':scope > ' + selector) : parent;
  if (!node) return '';
  const t = node.querySelector(':scope > text');
  return (t ? t.textContent : node.textContent) ?? '';
}

function htmlOf(parent, selector) {
  return htmlToText(textOf(parent, selector));
}

function bool(parent, selector, fallback = false) {
  const v = textOf(parent, selector).trim().toLowerCase();
  if (v === '') return fallback;
  return v === 'true' || v === '1';
}

function number(parent, selector, fallback = 0) {
  const v = Number(textOf(parent, selector).trim());
  return Number.isNaN(v) ? fallback : v;
}

function answers(node) {
  return Array.from(node.querySelectorAll(':scope > answer')).map((a) => ({
    fraction: Number(a.getAttribute('fraction')) || 0,
    text: textOf(a),
    feedback: htmlOf(a, 'feedback'),
    tolerance: number(a, 'tolerance', 0),
  }));
}

const SUPPORTED = new Set(['multichoice', 'truefalse', 'shortanswer', 'numerical', 'matching', 'essay', 'cloze', 'description']);

/**
 * @returns {{questions: object[], category: string|null, skipped: string[]}}
 */
export function importMoodleXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Die Datei ist kein gültiges XML.');
  const quiz = doc.querySelector('quiz');
  if (!quiz) throw new Error('Die Datei enthält kein <quiz>-Element und ist damit keine Moodle-XML-Datei.');

  const result = { questions: [], category: null, skipped: [] };

  for (const node of Array.from(quiz.querySelectorAll(':scope > question'))) {
    const type = (node.getAttribute('type') || '').trim();
    if (type === 'category') {
      const cat = textOf(node, 'category').trim();
      if (cat && result.category === null) result.category = cat;
      continue;
    }
    if (!SUPPORTED.has(type)) {
      result.skipped.push(`${textOf(node, 'name') || '(ohne Titel)'} (Typ "${type}" wird nicht unterstützt)`);
      continue;
    }
    const q = createQuestion(type);
    q.name = textOf(node, 'name').trim();
    q.text = type === 'cloze' ? textOf(node, 'questiontext') : htmlOf(node, 'questiontext');
    q.generalFeedback = htmlOf(node, 'generalfeedback');
    q.defaultGrade = number(node, 'defaultgrade', q.defaultGrade);
    q.penalty = number(node, 'penalty', q.penalty);
    q.tags = Array.from(node.querySelectorAll(':scope > tags > tag'))
      .map((t) => textOf(t).trim())
      .filter(Boolean)
      .join(', ');

    switch (type) {
      case 'multichoice': {
        q.single = bool(node, 'single', true);
        q.shuffle = bool(node, 'shuffleanswers', true);
        q.numbering = textOf(node, 'answernumbering').trim() || 'abc';
        q.correctFeedback = htmlOf(node, 'correctfeedback');
        q.partialFeedback = htmlOf(node, 'partiallycorrectfeedback');
        q.incorrectFeedback = htmlOf(node, 'incorrectfeedback');
        const list = answers(node);
        q.answers = list.map((a) =>
          newAnswer({ text: htmlToText(a.text), correct: a.fraction > 0, fraction: a.fraction, feedback: a.feedback }),
        );
        // Prüfen, ob die Automatik das gleiche Ergebnis liefern würde.
        const nCorrect = q.answers.filter((a) => a.correct).length || 1;
        const auto = q.answers.every((a) => {
          const expected = q.single ? (a.correct ? 100 : 0) : a.correct ? 100 / nCorrect : -100 / nCorrect;
          return Math.abs(expected - a.fraction) < 0.01;
        });
        q.autoFractions = auto;
        break;
      }
      case 'truefalse': {
        const list = answers(node);
        const t = list.find((a) => a.text.trim().toLowerCase() === 'true');
        const f = list.find((a) => a.text.trim().toLowerCase() === 'false');
        q.correctAnswer = t ? t.fraction > 0 : !(f && f.fraction > 0);
        q.feedbackTrue = t?.feedback || '';
        q.feedbackFalse = f?.feedback || '';
        break;
      }
      case 'shortanswer': {
        q.usecase = bool(node, 'usecase', false);
        q.answers = answers(node).map((a) => newAnswer({ text: a.text.trim(), fraction: a.fraction, feedback: a.feedback }));
        break;
      }
      case 'numerical': {
        q.answers = answers(node).map((a) =>
          newAnswer({ text: a.text.trim(), fraction: a.fraction, feedback: a.feedback, tolerance: a.tolerance }),
        );
        break;
      }
      case 'matching': {
        q.shuffle = bool(node, 'shuffleanswers', true);
        q.correctFeedback = htmlOf(node, 'correctfeedback');
        q.partialFeedback = htmlOf(node, 'partiallycorrectfeedback');
        q.incorrectFeedback = htmlOf(node, 'incorrectfeedback');
        q.pairs = Array.from(node.querySelectorAll(':scope > subquestion')).map((s) =>
          newPair({ question: htmlOf(s), answer: textOf(s, 'answer').trim() }),
        );
        break;
      }
      case 'essay': {
        q.responseFormat = textOf(node, 'responseformat').trim() || 'editor';
        q.responseRequired = bool(node, 'responserequired', true);
        q.responseFieldLines = number(node, 'responsefieldlines', 15);
        q.attachments = number(node, 'attachments', 0);
        q.attachmentsRequired = number(node, 'attachmentsrequired', 0);
        q.graderInfo = htmlOf(node, 'graderinfo');
        q.responseTemplate = htmlOf(node, 'responsetemplate');
        break;
      }
      default:
        break;
    }
    result.questions.push(q);
  }
  return result;
}
