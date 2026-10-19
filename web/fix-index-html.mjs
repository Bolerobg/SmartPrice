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
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

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
      /* ВАЖНО за iPhone: Safari зуумва САМ, щом докоснеш поле за писане с
         шрифт под 16px. Тогава страницата „излиза" от екрана и бутоните се
         губят точно когато човекът тръгне да пише. Затова на телефон всички
         полета са поне 16px — тогава зум изобщо не се случва. */
      @media (max-width: 820px) {
        #root input,
        #root textarea {
          font-size: 16px !important;
          line-height: 22px !important;
        }
      }
      /* Полетата за писане остават нормално докосваеми и селектируеми —
         iPhone отваря клавиатурата само когато полето е истински „живо“. */
      #root input,
      #root textarea {
        touch-action: manipulation;
        -webkit-user-select: text;
        user-select: text;
        -webkit-user-modify: read-write;
        pointer-events: auto;
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

// 2б. Иконата на приложението + PWA тагове.
//     Без това телефонът слага произволна картинка (или буква) на началния
//     екран. Иконите идват от web/make-icons.py и се копират от public/.
const ICONS = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#0B1424" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="SmartPrice" />`;

html = html.replace('</head>', `${ICONS}\n  </head>`);

// 3. Език
html = html.replace('<html lang="en">', '<html lang="bg">');

// 4. Заглавие на страницата
html = html.replace(
  '<title>SmartPrice</title>',
  '<title>SmartPrice — реални цени, честни места</title>\n    <meta name="description" content="Споделяй реални цени, откривай изгодното и разобличавай капаните. Без реклами и платени ревюта." />'
);

// 5. Проверка за нова версия — вграден номер на билда + малка проверка.
//
//    Защо: телефонът (особено инсталираното приложение на iPhone) пази СТАРИЯ
//    вариант и новите неща „не се виждат“, докато човекът не изтрие иконата и
//    не я сложи наново. Затова вграждаме номера на билда в самата страница и
//    добавяме проверка: щом на сървъра номерът е друг, долу се появява
//    дискретно съобщение „Нова версия е готова“ — с едно натискане приложението
//    се обновява. Нищо не се презарежда само, за да не се губи написаното.
const version = createHash('md5').update(html).digest('hex').slice(0, 12);

const VERSION_JS = `<script id="smartprice-version">
(function(){
  var BUILD = '${version}';
  var shown = false;
  function pill(){
    var el = document.getElementById('sp-new-version');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'sp-new-version';
    el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;' +
      'display:flex;align-items:center;gap:8px;padding:11px 16px;border-radius:999px;cursor:pointer;' +
      'max-width:92vw;background:linear-gradient(135deg,#0B1424,#12213A);' +
      'border:1px solid rgba(34,211,238,0.5);box-shadow:0 12px 34px rgba(0,0,0,0.5);color:#F8FAFC;' +
      'font:800 13.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      '-webkit-tap-highlight-color:transparent';
    el.textContent = '\uD83D\uDD04 Нова версия е готова — натисни, за да се обнови';
    el.onclick = function(){
      el.textContent = 'Обновявам…';
      function go(){
        // ВАЖНО (проверено 19.10.2026): обикновеното location.reload() на iPhone
        // връща СЪЩИЯ стар документ от кеша на приложението и човекът остава на
        // старата версия, дори след като е натиснал „обнови“. Затова презареждаме
        // на нов адрес (?_v=<време>) — така телефонът е длъжен да вземе новата
        // страница от сървъра, а тя сочи новия JS пакет.
        try {
          var u = location.href.replace(/([?&])_v=\d+/g, '').replace(/[?&]$/, '');
          u += (u.indexOf('?') === -1 ? '?' : '&') + '_v=' + Date.now();
          location.replace(u);
        } catch (e) { location.reload(); }
      }
      try {
        if (window.caches && caches.keys) {
          caches.keys()
            .then(function(keys){ return Promise.all(keys.map(function(k){ return caches.delete(k); })); })
            .then(go)['catch'](go);
          setTimeout(go, 900);
          return;
        }
      } catch (e) {}
      go();
    };
    (document.body || document.documentElement).appendChild(el);
    return el;
  }
  function check(){
    fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if (!j || !j.v || j.v === BUILD) return;
        if (shown) return;
        shown = true;
        pill();
      })['catch'](function(){});
  }
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  setTimeout(check, 4000);
})();
</script>`;

if (html.includes('</body>')) {
  html = html.replace('</body>', `${VERSION_JS}\n  </body>`);
} else {
  html = html.replace('</head>', `${VERSION_JS}\n  </head>`);
}

writeFileSync(path, html, 'utf8');

// Номерът на билда като отделен файл — това проверява приложението
writeFileSync(
  join(dirname(path), 'version.json'),
  JSON.stringify({ v: version, at: new Date().toISOString() }) + '\n',
  'utf8'
);

console.log('[fix-index-html] готово');
console.log('  viewport-fit=cover:', html.includes('viewport-fit=cover'));
console.log('  мобилен CSS:', html.includes('smartprice-mobile-fit'));
console.log('  език bg:', html.includes('<html lang="bg">'));
console.log('  проверка за нова версия:', html.includes('smartprice-version'), '· билд', version);