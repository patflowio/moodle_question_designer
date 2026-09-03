// Export im Moodle-XML-Format (Fragensammlung → Import → "Moodle-XML-Format").
import { escapeXml, textToHtml, formatFraction } from './util.js';
import { multichoiceFractions, parseNumber } from './types.js';

const NL = '\n';

function cdata(s) {
  // "]]>" darf in CDATA nicht vorkommen → aufteilen.
  return '<![CDATA[' + String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
}

function htmlText(value) {
  const html = textToHtml(value);
  return html ? cdata(html) : '';
}

function htmlField(tag, value, indent = '    ') {
  return `${indent}<${tag} format="html">${NL}${indent}  <text>${htmlText(value)}</text>${NL}${indent}</${tag}>`;
}

function plainText(tag, value, indent = '    ') {
  return `${indent}<${tag}>${NL}${indent}  <text>${escapeXml(value)}</text>${NL}${indent}</${tag}>`;
}

function num(n, digits = 7) {
  return (Number(n) || 0).toFixed(digits);
}

function answer(text, fraction, feedback, { format = 'html', extra = '' } = {}) {
  const body = format === 'html' ? htmlText(text) : escapeXml(text);
  return [
    `    <answer fraction="${formatFraction(fraction)}" format="${format}">`,
    `      <text>${body}</text>`,
    `      <feedback format="html">`,
    `        <text>${htmlText(feedback)}</text>`,
    `      </feedback>`,
    extra,
    `    </answer>`,
  ]
    .filter(Boolean)
    .join(NL);
}

function combinedFeedback(q) {
  return [
    htmlField('correctfeedback', q.correctFeedback ?? ''),
    htmlField('partiallycorrectfeedback', q.partialFeedback ?? ''),
    htmlField('incorrectfeedback', q.incorrectFeedback ?? ''),
    '    <shownumcorrect/>',
  ].join(NL);
}

function header(q) {
  const lines = [
    plainText('name', q.name || 'Frage'),
    htmlField('questiontext', q.text),
    htmlField('generalfeedback', q.generalFeedback),
  ];
  if (q.type !== 'description') {
    lines.push(`    <defaultgrade>${num(q.defaultGrade)}</defaultgrade>`);
    lines.push(`    <penalty>${num(q.penalty)}</penalty>`);
  }
  lines.push('    <hidden>0</hidden>');
  lines.push('    <idnumber></idnumber>');
  return lines.join(NL);
}

function tagsBlock(q) {
  const tags = String(q.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tags.length) return '';
  return ['    <tags>', ...tags.map((t) => `      <tag><text>${escapeXml(t)}</text></tag>`), '    </tags>'].join(NL);
}

function questionBody(q) {
  switch (q.type) {
    case 'multichoice': {
      const answers = (q.answers || []).filter((a) => String(a.text ?? '').trim() !== '');
      const fractions = multichoiceFractions({ ...q, answers });
      return [
        `    <single>${q.single ? 'true' : 'false'}</single>`,
        `    <shuffleanswers>${q.shuffle ? 'true' : 'false'}</shuffleanswers>`,
        `    <answernumbering>${escapeXml(q.numbering || 'abc')}</answernumbering>`,
        `    <showstandardinstruction>0</showstandardinstruction>`,
        combinedFeedback(q),
        ...answers.map((a, i) => answer(a.text, fractions[i], a.feedback)),
      ].join(NL);
    }
    case 'truefalse': {
      const t = q.correctAnswer !== false;
      return [
        answer('true', t ? 100 : 0, q.feedbackTrue, { format: 'moodle_auto_format' }),
        answer('false', t ? 0 : 100, q.feedbackFalse, { format: 'moodle_auto_format' }),
      ].join(NL);
    }
    case 'shortanswer': {
      const answers = (q.answers || []).filter((a) => String(a.text ?? '').trim() !== '');
      return [
        `    <usecase>${q.usecase ? 1 : 0}</usecase>`,
        ...answers.map((a) => answer(a.text.trim(), a.fraction, a.feedback, { format: 'moodle_auto_format' })),
      ].join(NL);
    }
    case 'numerical': {
      const answers = (q.answers || []).filter((a) => String(a.text ?? '').trim() !== '');
      return [
        ...answers.map((a) => {
          const raw = String(a.text).trim();
          const value = raw === '*' ? '*' : String(parseNumber(raw));
          const tol = Number(String(a.tolerance ?? 0).replace(',', '.')) || 0;
          return answer(value, a.fraction, a.feedback, {
            format: 'moodle_auto_format',
            extra: `      <tolerance>${tol}</tolerance>`,
          });
        }),
        '    <unitgradingtype>0</unitgradingtype>',
        '    <unitpenalty>0.1000000</unitpenalty>',
        '    <showunits>3</showunits>',
        '    <unitsleft>0</unitsleft>',
      ].join(NL);
    }
    case 'matching': {
      const pairs = (q.pairs || []).filter((p) => String(p.answer ?? '').trim() !== '');
      return [
        `    <shuffleanswers>${q.shuffle ? 'true' : 'false'}</shuffleanswers>`,
        combinedFeedback(q),
        ...pairs.map((p) =>
          [
            '    <subquestion format="html">',
            `      <text>${htmlText(p.question)}</text>`,
            '      <answer>',
            `        <text>${escapeXml(String(p.answer).trim())}</text>`,
            '      </answer>',
            '    </subquestion>',
          ].join(NL),
        ),
      ].join(NL);
    }
    case 'essay':
      return [
        `    <responseformat>${escapeXml(q.responseFormat || 'editor')}</responseformat>`,
        `    <responserequired>${q.responseRequired === false ? 0 : 1}</responserequired>`,
        `    <responsefieldlines>${Number(q.responseFieldLines) || 15}</responsefieldlines>`,
        '    <minwordlimit></minwordlimit>',
        '    <maxwordlimit></maxwordlimit>',
        `    <attachments>${Number(q.attachments) || 0}</attachments>`,
        `    <attachmentsrequired>${Number(q.attachmentsRequired) || 0}</attachmentsrequired>`,
        '    <maxbytes>0</maxbytes>',
        '    <filetypeslist></filetypeslist>',
        htmlField('graderinfo', q.graderInfo),
        htmlField('responsetemplate', q.responseTemplate),
      ].join(NL);
    case 'cloze':
    case 'description':
    default:
      return '';
  }
}

export function questionToXml(q) {
  return [`  <question type="${escapeXml(q.type)}">`, header(q), questionBody(q), tagsBlock(q), '  </question>']
    .filter((s) => s !== '')
    .join(NL);
}

/**
 * @param {object[]} questions
 * @param {{category?: string}} options
 */
export function exportMoodleXml(questions, { category = '' } = {}) {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<quiz>'];
  if (category && category.trim()) {
    parts.push(
      [
        '  <question type="category">',
        '    <category>',
        `      <text>${escapeXml(category.trim())}</text>`,
        '    </category>',
        '    <info format="html">',
        '      <text></text>',
        '    </info>',
        '    <idnumber></idnumber>',
        '  </question>',
      ].join(NL),
    );
  }
  for (const q of questions) parts.push(questionToXml(q));
  parts.push('</quiz>', '');
  return parts.join(NL);
}
