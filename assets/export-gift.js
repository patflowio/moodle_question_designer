// Export im GIFT-Format (Textformat, das Moodle ebenfalls importieren kann).
import { formatFraction, textToHtml, looksLikeHtml } from './util.js';
import { multichoiceFractions, parseNumber } from './types.js';

/** Sonderzeichen in GIFT maskieren. */
function esc(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/([~=#{}:])/g, '\\$1');
}

/** Text ggf. als HTML kennzeichnen. */
function body(s) {
  const str = String(s ?? '').replace(/\r\n?/g, '\n').trim();
  if (looksLikeHtml(str) || str.includes('\n')) return '[html]' + esc(textToHtml(str)).replace(/\n/g, ' ');
  return esc(str);
}

function fb(s) {
  const str = String(s ?? '').trim();
  return str ? '#' + body(str) : '';
}

function general(q) {
  const g = String(q.generalFeedback ?? '').trim();
  return g ? '\n  ####' + body(g) : '';
}

function title(q) {
  return '::' + esc(q.name || 'Frage').replace(/\n/g, ' ') + '::';
}

function comment(q, i) {
  return `// Frage ${i + 1}: ${String(q.name || '').replace(/\n/g, ' ')}`;
}

export function questionToGift(q) {
  const head = title(q) + body(q.text);
  switch (q.type) {
    case 'multichoice': {
      const answers = (q.answers || []).filter((a) => String(a.text ?? '').trim() !== '');
      const fractions = multichoiceFractions({ ...q, answers });
      const lines = answers.map((a, i) => {
        const f = fractions[i];
        if (q.single && f === 100) return '  =' + body(a.text) + fb(a.feedback);
        if (q.single && f === 0) return '  ~' + body(a.text) + fb(a.feedback);
        return `  ~%${formatFraction(f)}%` + body(a.text) + fb(a.feedback);
      });
      return `${head} {\n${lines.join('\n')}${general(q)}\n}`;
    }
    case 'truefalse': {
      const t = q.correctAnswer !== false;
      // {T#Feedback bei falscher Antwort#Feedback bei richtiger Antwort}
      const wrong = t ? q.feedbackFalse : q.feedbackTrue;
      const right = t ? q.feedbackTrue : q.feedbackFalse;
      let inner = t ? 'TRUE' : 'FALSE';
      if (wrong || right) inner += '#' + body(wrong || '') + '#' + body(right || '');
      return `${head} {${inner}${general(q)}}`;
    }
    case 'shortanswer': {
      const answers = (q.answers || []).filter((a) => String(a.text ?? '').trim() !== '');
      const lines = answers.map((a) => {
        const f = Number(a.fraction);
        const prefix = f === 100 ? '  =' : `  =%${formatFraction(f)}%`;
        return prefix + esc(a.text.trim()) + fb(a.feedback);
      });
      return `${head} {\n${lines.join('\n')}${general(q)}\n}`;
    }
    case 'numerical': {
      const answers = (q.answers || []).filter((a) => String(a.text ?? '').trim() !== '');
      const lines = answers.map((a) => {
        const f = Number(a.fraction);
        const raw = String(a.text).trim();
        const value = raw === '*' ? '*' : String(parseNumber(raw));
        const tol = Number(String(a.tolerance ?? 0).replace(',', '.')) || 0;
        const prefix = f === 100 ? '  =' : `  =%${formatFraction(f)}%`;
        return prefix + value + (tol ? ':' + tol : '') + fb(a.feedback);
      });
      return `${head} {#\n${lines.join('\n')}${general(q)}\n}`;
    }
    case 'matching': {
      const pairs = (q.pairs || []).filter((p) => String(p.answer ?? '').trim() !== '');
      const lines = pairs.map((p) => '  =' + body(p.question) + ' -> ' + esc(String(p.answer).trim()));
      return `${head} {\n${lines.join('\n')}${general(q)}\n}`;
    }
    case 'essay':
      return `${head} {${general(q)}}`;
    case 'description':
      return head;
    case 'cloze':
      return null; // GIFT kennt keine Cloze-Fragen
    default:
      return null;
  }
}

/**
 * @returns {{text: string, skipped: object[]}}
 */
export function exportGift(questions, { category = '' } = {}) {
  const out = [];
  const skipped = [];
  if (category && category.trim()) out.push('$CATEGORY: ' + category.trim(), '');
  questions.forEach((q, i) => {
    const g = questionToGift(q);
    if (g === null) {
      skipped.push(q);
      return;
    }
    out.push(comment(q, i), g, '');
  });
  return { text: out.join('\n'), skipped };
}
