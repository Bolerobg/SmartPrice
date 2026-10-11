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
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#0B0F1A" />
        {/* Основният ресет на Expo за ScrollView */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
/* ---- Ширината на документа никога не надхвърля екрана ---- */
html, body {
  height: 100%;
  max-width: 100%;
  overflow-x: hidden;
  overscroll-behavior-x: none;
}
body { margin: 0; background-color: #0B0F1A; -webkit-text-size-adjust: 100%; }

/* ---- Коренът е точно колкото екрана ---- */
#root {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100vw;
  min-height: 100%;
  overflow-x: hidden;
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
  overflow-wrap: anywhere;
}

/* ---- Хоризонталните ленти с чипове продължават да скролват ---- */
#root [style*="overflow-x: auto"],
#root [style*="overflow-x:auto"],
#root [style*="overflow: scroll"] {
  max-width: 100%;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
#root [style*="overflow-x: auto"]::-webkit-scrollbar,
#root [style*="overflow-x:auto"]::-webkit-scrollbar {
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