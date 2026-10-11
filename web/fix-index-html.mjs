/**
 * Вкарва нужния viewport и CSS в генерирания от Expo index.html.
 *
 * Защо е нужно: `app/+html.tsx` НЕ се прилага, когато `web.output` е 'single'
 * (SPA режим) — Expo генерира index.html сам и го подминава. Затова коригираме
 * готовия файл тук, за да е гарантирано.
 *
 * Проблемът, който решава: на телефон страницата излизаше по-широка от екрана
 * и дясната част се режеше. Причината: React Native Web слага `flex-shrink: 0`
 * на всички View елементи, затова всеки ред, по-широк от екрана, разтяга
 * целия документ вместо да се свие.
 *
 * Употреба: node fix-index-html.mjs /out/index.html
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Употреба: node fix-index-html.mjs <път до index.html>');
  process.exit(1);
}

let html = readFileSync(path, 'utf8');

const VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />';

const CSS = `<style id="smartprice-mobile-fit">
      /* Ширината на документа никога не надхвърля екрана */
      html, body {
        max-width: 100%;
        overflow-x: hidden;
        overscroll-behavior-x: none;
        -webkit-text-size-adjust: 100%;
      }
      /* Коренът е точно колкото екрана */
      #root {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: 100vw;
        overflow-x: hidden;
      }
      /* ВАЖНО: тук НЕ слагаме flex-shrink на всички div. Такова глобално
         правило чупи хоризонталните carousel-и — страниците на onboarding-а
         се свиваха една в друга и се виждаха 5-6 наведнъж в един екран.
         Широките редове се оправят точково в самите компоненти. */
      #root [dir="auto"] {
        overflow-wrap: anywhere;
      }
      /* Хоризонталните ленти с чипове продължават да скролват, но не
         разширяват страницата */
      #root [style*="overflow-x: auto"] {
        max-width: 100%;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      #root [style*="overflow-x: auto"]::-webkit-scrollbar {
        display: none;
      }
    </style>`;

// 1. Правилният viewport (с viewport-fit=cover за notch-а)
if (html.includes('<meta name="viewport"')) {
  html = html.replace(/<meta name="viewport"[^>]*>/, VIEWPORT);
} else {
  html = html.replace('<head>', `<head>\n    ${VIEWPORT}`);
}

// 2. CSS-ът преди </head>
html = html.replace('</head>', `${CSS}\n  </head>`);

// 3. Език
html = html.replace('<html lang="en">', '<html lang="bg">');

// 4. Заглавие на страницата
html = html.replace(
  '<title>SmartPrice</title>',
  '<title>SmartPrice — реални цени, честни места</title>\n    <meta name="description" content="Споделяй реални цени, откривай изгодното и разобличавай капаните. Без реклами и платени ревюта." />'
);

writeFileSync(path, html, 'utf8');

console.log('[fix-index-html] готово');
console.log('  viewport-fit=cover:', html.includes('viewport-fit=cover'));
console.log('  мобилен CSS:', html.includes('smartprice-mobile-fit'));
console.log('  език bg:', html.includes('<html lang="bg">'));