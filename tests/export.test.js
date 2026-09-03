import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMoodleXml } from '../assets/export-xml.js';
import { exportGift } from '../assets/export-gift.js';
import { createQuestion, multichoiceFractions } from '../assets/types.js';
import { textToHtml, formatFraction } from '../assets/util.js';

function mc(single = true) {
  const q = createQuestion('multichoice');
  q.name = 'Hauptstadt';
  q.text = 'Was ist die Hauptstadt von Deutschland?';
  q.single = single;
  q.answers[0].text = 'Berlin';
  q.answers[0].correct = true;
  q.answers[1].text = 'München';
  q.answers[2].text = 'Hamburg';
  return q;
}

test('textToHtml wraps plain paragraphs and keeps html', () => {
  assert.equal(textToHtml('a\n\nb & c'), '<p>a</p>\n<p>b &amp; c</p>');
  assert.equal(textToHtml('<p>x</p>'), '<p>x</p>');
  assert.equal(textToHtml(''), '');
});

test('formatFraction produces moodle-compatible values', () => {
  assert.equal(formatFraction(100 / 3), '33.33333');
  assert.equal(formatFraction(50), '50');
  assert.equal(formatFraction(-100 / 3), '-33.33333');
});

test('multichoice fractions', () => {
  const q = mc(false);
  q.answers[1].correct = true;
  assert.deepEqual(multichoiceFractions(q), [50, 50, -50]);
  assert.deepEqual(multichoiceFractions(mc(true)), [100, 0, 0]);
});

test('moodle xml export contains category and questions', () => {
  const q1 = mc();
  const q2 = createQuestion('truefalse');
  q2.name = 'Wahr?';
  q2.text = 'Die Erde ist rund.';
  const q3 = createQuestion('numerical');
  q3.name = 'Zahl';
  q3.text = 'Wieviel ist 6*7?';
  q3.answers[0].text = '42';
  q3.answers[0].tolerance = 0.5;
  const q4 = createQuestion('matching');
  q4.name = 'Zuordnung';
  q4.text = 'Ordne zu';
  q4.pairs[0].question = 'Deutschland';
  q4.pairs[0].answer = 'Berlin';
  q4.pairs[1].question = 'Frankreich';
  q4.pairs[1].answer = 'Paris';
  const q5 = createQuestion('shortanswer');
  q5.name = 'Kurz';
  q5.text = '<p>Farbe des Himmels? ]]> Test</p>';
  q5.answers[0].text = 'blau';
  const q6 = createQuestion('essay');
  q6.name = 'Essay';
  q6.text = 'Erkläre.';
  const q7 = createQuestion('cloze');
  q7.name = 'Cloze';
  q7.text = 'Die Hauptstadt ist {1:SHORTANSWER:=Berlin}.';
  const q8 = createQuestion('description');
  q8.name = 'Info';
  q8.text = 'Hinweis';

  const xml = exportMoodleXml([q1, q2, q3, q4, q5, q6, q7, q8], { category: '$course$/top/Test' });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<quiz>/);
  assert.match(xml, /<question type="category">[\s\S]*\$course\$\/top\/Test/);
  for (const t of ['multichoice', 'truefalse', 'numerical', 'matching', 'shortanswer', 'essay', 'cloze', 'description']) {
    assert.match(xml, new RegExp(`<question type="${t}">`));
  }
  assert.equal((xml.match(/<question /g) || []).length, 9);
  assert.equal((xml.match(/<\/question>/g) || []).length, 9);
  assert.match(xml, /<answer fraction="100" format="html">\s*<text><!\[CDATA\[<p>Berlin<\/p>\]\]><\/text>/);
  assert.match(xml, /<tolerance>0.5<\/tolerance>/);
  assert.match(xml, /<subquestion format="html">[\s\S]*Deutschland[\s\S]*<answer>\s*<text>Berlin<\/text>/);
  assert.match(xml, /\]\]\]\]><!\[CDATA\[>/, 'CDATA end sequence must be split');
  assert.doesNotMatch(xml, /<defaultgrade>[\s\S]{0,200}<question type="description">[\s\S]*?<defaultgrade>/);
});

test('gift export escapes special characters and skips cloze', () => {
  const q = mc();
  q.answers[1].text = 'a=b {x}';
  const c = createQuestion('cloze');
  c.name = 'C';
  c.text = '{1:SA:=x}';
  const { text, skipped } = exportGift([q, c], { category: 'Kat' });
  assert.match(text, /^\$CATEGORY: Kat/);
  assert.match(text, /::Hauptstadt::Was ist die Hauptstadt von Deutschland\? \{/);
  assert.match(text, /=Berlin/);
  assert.match(text, /~a\\=b \\\{x\\\}/);
  assert.equal(skipped.length, 1);
});
