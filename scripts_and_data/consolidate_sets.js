const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'books_data.js');
let code = fs.readFileSync(dataPath, 'utf8').trim();
let data = JSON.parse(code.replace(/^const BOOKS_DATA = /, '').replace(/;$/, ''));

let totalBefore = 0;
data.forEach(b => totalBefore += (b.books || []).length);

// Custom known series matchers
const knownPrefixes = [
  'משנה תורה להרמב"ם (מהדורת שבתי פרנקל)',
  'משנה תורה להרמב"ם',
  'הרמב"ם השלם החדש (משנה תורה להרמב"ם)',
  'הרמב"ם השלם החדש',
  'ספר משנה ברורה המנוקד (איש מצליח)',
  'ספר משנה ברורה המנוקד',
  'משנה ברורה',
  'בית הבחירה למאירי',
  'חדושי הרשב"א השלם המבואר',
  'חידושי הרשב"א',
  'חידושי הרמב"ן השלם (מכון הרב הרשלר)',
  'חידושי הרמב"ן',
  'חידושי הריטב"א על הש"ס',
  'חידושי הריטב"א',
  'שיטה מקובצת השלם',
  'שיטה מקובצת',
  'תלמוד ירושלמי',
  'תלמוד בבלי',
  'ש"ס תלמוד בבלי',
  'מדרש רבה עם כל המפרשים',
  'מדרש רבה',
  'ילקוט שמעוני',
  'אגדות חז"ל מעובדות לנוער',
  'דעת מקרא - מוסד הרב קוק',
  'דעת מקרא',
  'סדרת דעת מקרא',
  'ילקוט מעם לועז',
  'ספר הפרשיות',
  'המלון החדש',
  'מילון אבן שושן',
  'עיטורי תורה',
  'אורות הקודש',
  'חומש רב פנינים',
  'חומש תורה תמימה',
  'חק לישראל',
  'מדור דור',
  'בדרכי אבותינו',
  'בעקבות רבותינו',
  'משניות מבוארות קהתי',
  'ספר המועדים'
];

let consolidatedData = data.map(box => {
  let books = box.books || [];
  let newBooks = [];
  let handledIds = new Set();
  let groups = {};

  // 1. Group by known prefixes first
  knownPrefixes.forEach(prefix => {
    let matches = books.filter(b => !handledIds.has(b.id) && b.title.startsWith(prefix));
    if (matches.length >= 2) {
      matches.forEach(m => handledIds.add(m.id));
      groups[prefix] = matches;
    }
  });

  // 2. Generic regex for any other multi-volume groups
  books.forEach(b => {
    if (handledIds.has(b.id)) return;
    let m = b.title.match(/^(.+?)(?:\s*[\-–—:]\s*|\s+)(?:כרך|חלק|ספר|מסכת)\s*([א-ת0-9ivx\s\"\']+)(?:\s*[\(].*[\)])?$/i);
    if (!m) {
      m = b.title.match(/^(.+?)(?:\s+)(?:א|ב|ג|ד|ה|ו|ז|ח|ט|י|יא|יב|יג|יד|טו|טז)\b(?:\s*[\-–—:]\s*(.*))?$/i);
    }
    if (m) {
      let base = m[1].replace(/[\(\)]/g, '').trim().replace(/^(סט|סדרת)\s+/, '');
      if (base.length >= 4) {
        if (!groups[base]) groups[base] = [];
        groups[base].push(b);
      }
    }
  });

  // Consolidate groups
  for (let base in groups) {
    let items = groups[base];
    if (items.length >= 2) {
      items.forEach(b => handledIds.add(b.id));

      let volumeList = items.map(b => b.title);
      let author = items[0].author || '';

      newBooks.push({
        id: `set_${box.box_id}_${Math.random().toString(36).substr(2, 6)}`,
        title: `${base} (סט שלם - ${items.length} כרכים)`,
        author: author ? `${author}` : '',
        is_set: true,
        volumes_count: items.length,
        volumes: volumeList,
        notes: `כולל ${items.length} כרכים: ${volumeList.join(', ')}`
      });
    }
  }

  // Add individual books that weren't part of multi-volume sets
  books.forEach(b => {
    if (!handledIds.has(b.id)) {
      let isSet = b.is_set || (b.title && (b.title.includes('סט ') || b.title.includes('כרכים')));
      newBooks.push({
        ...b,
        is_set: !!isSet
      });
    }
  });

  return {
    ...box,
    books: newBooks
  };
});

let totalAfter = 0;
let setsCount = 0;
consolidatedData.forEach(b => {
  totalAfter += b.books.length;
  b.books.forEach(book => {
    if (book.is_set) setsCount++;
  });
});

console.log('Books/entries before:', totalBefore);
console.log('Total entries after consolidation:', totalAfter);
console.log('Total complete sets created:', setsCount);

// Write back to books_data.js
const newCode = `const BOOKS_DATA = ${JSON.stringify(consolidatedData, null, 2)};\n`;
fs.writeFileSync(dataPath, newCode, 'utf8');
console.log('Updated books_data.js successfully!');
