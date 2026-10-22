import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Обвивката на HTML за уеб версията.
 *
 * Защо съществува: на телефон страницата излизаше по-широка от екрана и
 * дясната част се режеше. Причината е, че React Native Web слага
 * `flex-shrink: 0` на всички View елементи (за разлика от нормалния CSS).
 * Затова всеки ред, чието съдържание е по-широко от екрана, НЕ се свива,
 * а разширява цялата страница.
 *
 * Тук: заключваме ширината на документа към екрана и позволяваме на
 * елементите да се свиват, така че редовете да се събират.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="bg">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=5, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#f8f9ff" />
        {/* Тъмната тема се прилага ОЩЕ ПРЕДИ първото рисуване — иначе премигва бяло.
            Изборът се пази в localStorage (`sp_theme`). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  try {
    var saved = localStorage.getItem('sp_theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.backgroundColor = dark ? '#0f1413' : '#f8f9ff';
    document.documentElement.style.color = dark ? '#dfe4e1' : '#0b1c30';
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#0f1413' : '#f8f9ff');
  } catch (e) {}
})();
`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
        {/* Основният ресет на Expo за ScrollView */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
/* ---- Spesti & Otkriy Light Utilitarian Design System & Plus Jakarta Sans ---- */
:root {
  color-scheme: light;
}
html, body {
  height: 100%;
  max-width: 100%;
  overflow-x: hidden;
  overscroll-behavior: none;
  background-color: #f8f9ff;
  color: #0b1c30;
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
  text-align: start;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
html[data-theme="dark"] {
  color-scheme: dark;
}
html[data-theme="dark"], html[data-theme="dark"] body, html[data-theme="dark"] #root {
  background-color: #0f1413 !important;
  color: #dfe4e1;
}
html[data-theme="dark"] ::selection {
  background: rgba(78, 222, 163, 0.28);
  color: #dfe4e1;
}
body {
  margin: 0;
  background-color: #f8f9ff;
  -webkit-text-size-adjust: 100%;
}

::selection {
  background: rgba(16, 185, 129, 0.22);
  color: #0b1c30;
}

/* Force Plus Jakarta Sans & tabular numerals for prices */
#root, #root div, #root span, #root p, #root input, #root textarea, #root button {
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-variant-numeric: tabular-nums;
}

/* ---- Коренът е точно колкото екрана ---- */
#root {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100vw;
  min-height: 100%;
  overflow-x: hidden;
  background-color: #f8f9ff;
}

/* ---- Ключовата поправка ----
   RN Web слага flex-shrink: 0 на всичко. Затова широките редове
   разтягат страницата вместо да се свият. Разрешаваме свиване на
   всички контейнери и текстове, за да се събират в екрана. */
#root div,
#root span,
#root input,
#root textarea {
  min-width: 0;
}
#root div {
  flex-shrink: 1;
}

/* Текстът се пренася, вместо да избутва ширината */
#root [dir="auto"] {
  overflow-wrap: break-word;
}

/* ---- Хоризонталните ленти с чипове продължават да скролват ---- */
#root [style*="overflow-x: auto"],
#root [style*="overflow-x:auto"],
#root [style*="overflow: scroll"] {
  max-width: 100%;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
::-webkit-scrollbar {
  display: none;
}
`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}