import sharp from 'sharp';
import QRCode from 'qrcode';
import { publicBase } from './referrals.js';

/**
 * Автогенерирана карта „Спестих X €“ — PNG за Stories / Viber / WhatsApp.
 *
 * Защо на сървъра, а не в телефона: картата трябва да е ЕДНАКВА навсякъде
 * (телефон, десктоп, споделена в чат) и да работи като линк, който може да се
 * сложи като og:image. Затова: SVG → PNG през sharp (librsvg), с вградени
 * шрифтове в контейнера (DejaVu Sans покрива кирилица).
 *
 * Размери: 1080×1920 (9:16) — точно форматът на Stories/Reels/TikTok.
 */

const W = 1080;
const H = 1920;

const GREEN = '#34D399';
const RED = '#FB7185';
const GOLD = '#FBBF24';
const CYAN = '#22D3EE';
const MUTED = '#94A3B8';
const FAINT = '#64748B';

export interface StoryCardInput {
  /** 'post' — за конкретна оферта; 'total' — колко е спестил човекът общо. */
  kind: 'post' | 'total';
  /** Спестената сума в евро. */
  amount: number;
  /** Заглавие на офертата (за kind='post'). */
  title?: string;
  place?: string;
  city?: string;
  polarity?: 'green' | 'red';
  paid?: number;
  reference?: number;
  /** Име на човека (за kind='total'). */
  name?: string;
  postsCount?: number;
  /** Код за покана — слага се в картата и в QR-а. */
  code?: string;
}

/* ------------------------------------------------------------------ helpers */

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Приблизителна ширина на символ (в em) — достатъчно точна за подравняване. */
function charWidth(ch: string): number {
  if (' .,:;!|iljtfrI()[]\'"-/\\·'.includes(ch)) return 0.32;
  if ('mwMWШЩЖМФЮw@'.includes(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (ch >= '0' && ch <= '9') return 0.58;
  return 0.55;
}

function textWidth(text: string, fontSize: number, bold: boolean): number {
  let sum = 0;
  for (const ch of text) sum += charWidth(ch);
  return sum * fontSize * (bold ? 1.06 : 1);
}

/** Пренася текста на редове по думи, за да се събере в maxWidth. */
function wrap(text: string, maxWidth: number, fontSize: number, bold: boolean, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, fontSize, bold) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // Ако сме прерязали — добавяме многоточие на последния ред.
  if (lines.length === maxLines) {
    const joined = lines.join(' ');
    if (joined.length < text.trim().length) {
      let last = lines[maxLines - 1];
      while (last.length > 4 && textWidth(`${last}…`, fontSize, bold) > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

/** 12.50 → „12,50 €“ (български десетичен знак). */
export function formatEuro(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

/** Рисува QR кода като редица от правоъгълници (без втора картинка). */
function qrPaths(text: string, x: number, y: number, size: number): string {
  let qr: ReturnType<typeof QRCode.create>;
  try {
    qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  } catch {
    return '';
  }
  const modules = qr.modules;
  const count = modules.size;
  const cell = size / count;
  const rects: string[] = [];

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!modules.data[row * count + col]) continue;
      const px = (x + col * cell).toFixed(2);
      const py = (y + row * cell).toFixed(2);
      const side = (cell + 0.6).toFixed(2); // леко застъпване → без бели линии
      rects.push(`<rect x="${px}" y="${py}" width="${side}" height="${side}" fill="#0B1424"/>`);
    }
  }
  return rects.join('');
}

/* --------------------------------------------------------------------- SVG */

function buildSvg(input: StoryCardInput): string {
  const isPost = input.kind === 'post';
  const accent = input.polarity === 'red' ? RED : GREEN;
  const amountStr = formatEuro(input.amount);

  // Големината на сумата се намалява, ако е дълга (напр. 1 234,56 €).
  let amountSize = 200;
  while (amountSize > 110 && textWidth(amountStr, amountSize, true) > 860) amountSize -= 6;

  const code = (input.code ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const qrTarget = code
    ? `${publicBase()}/register?ref=${code}`
    : publicBase();

  const lines: string[] = [];
  lines.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  lines.push(`<rect width="${W}" height="${H}" fill="url(#glow)"/>`);
  lines.push(
    `<rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="52" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="2"/>`
  );

  // --- Глава: лого + име на приложението
  lines.push(`<rect x="72" y="96" width="104" height="104" rx="30" fill="url(#logo)"/>`);
  lines.push(
    `<text x="124" y="165" font-family="DejaVu Sans" font-size="46" font-weight="bold" fill="#04121A" text-anchor="middle">SP</text>`
  );
  lines.push(
    `<text x="208" y="150" font-family="DejaVu Sans" font-size="56" font-weight="bold" fill="#F8FAFC">SmartPrice</text>`
  );
  lines.push(
    `<text x="210" y="196" font-family="DejaVu Sans" font-size="30" fill="${MUTED}">Помагаме си взаимно. Безплатно.</text>`
  );

  // --- Присъда (само за оферта)
  if (isPost) {
    const verdict = input.polarity === 'red' ? 'ЧЕРВЕН ФЛАГ · НЕ ХОДИ' : 'ТОП НАХОДКА';
    const vw = textWidth(verdict, 34, true) + 76;
    lines.push(
      `<rect x="72" y="268" width="${vw.toFixed(0)}" height="74" rx="37" fill="${accent}22" stroke="${accent}" stroke-width="2"/>`
    );
    lines.push(
      `<text x="${(72 + vw / 2).toFixed(0)}" y="316" font-family="DejaVu Sans" font-size="34" font-weight="bold" fill="${accent}" text-anchor="middle">${esc(verdict)}</text>`
    );
  }

  // --- Голямата цифра
  lines.push(
    `<text x="72" y="${isPost ? 520 : 430}" font-family="DejaVu Sans" font-size="46" font-weight="bold" letter-spacing="10" fill="${MUTED}">СПЕСТИХ</text>`
  );
  lines.push(
    `<text x="68" y="${isPost ? 700 : 640}" font-family="DejaVu Sans" font-size="${amountSize}" font-weight="bold" fill="${accent}">${esc(amountStr)}</text>`
  );
  lines.push(
    `<text x="72" y="${isPost ? 762 : 706}" font-family="DejaVu Sans" font-size="36" fill="${FAINT}">${
      isPost ? 'спрямо обичайната цена' : 'с помощта на общността'
    }</text>`
  );
  lines.push(
    `<line x1="72" y1="${isPost ? 826 : 776}" x2="${W - 72}" y2="${isPost ? 826 : 776}" stroke="rgba(148,163,184,0.22)" stroke-width="2"/>`
  );

  let y = isPost ? 916 : 870;

  if (isPost) {
    const titleLines = wrap(input.title ?? '', W - 160, 58, true, 3);
    for (const line of titleLines) {
      lines.push(
        `<text x="72" y="${y}" font-family="DejaVu Sans" font-size="58" font-weight="bold" fill="#F8FAFC">${esc(line)}</text>`
      );
      y += 76;
    }
    y += 12;

    const place = [input.place, input.city].filter(Boolean).join(' · ');
    if (place) {
      lines.push(
        `<text x="72" y="${y}" font-family="DejaVu Sans" font-size="42" fill="${MUTED}">${esc(place)}</text>`
      );
      y += 62;
    }

    if (input.paid !== undefined) {
      const parts = [`Платено ${formatEuro(input.paid)}`];
      if (input.reference !== undefined && input.reference > 0) {
        parts.push(`Обичайна ${formatEuro(input.reference)}`);
      }
      lines.push(
        `<text x="72" y="${y}" font-family="DejaVu Sans" font-size="36" fill="${FAINT}">${esc(parts.join('   ·   '))}</text>`
      );
    }
  } else {
    const name = (input.name ?? '').trim();
    if (name) {
      lines.push(
        `<text x="72" y="${y}" font-family="DejaVu Sans" font-size="58" font-weight="bold" fill="#F8FAFC">${esc(name)}</text>`
      );
      y += 78;
    }
    const sub = input.postsCount
      ? `от ${input.postsCount} реални цени, проверени на място`
      : 'от реални цени, проверени на място';
    lines.push(
      `<text x="72" y="${y}" font-family="DejaVu Sans" font-size="38" fill="${MUTED}">${esc(sub)}</text>`
    );
  }

  // --- Как работи (3 стъпки) — запълва средата и обяснява приложението
  // на всеки, който види картата. Това е рекламата, която не прилича на реклама.
  const steps = [
    'Качваш реална цена или касова бележка',
    'Другите виждат къде е изгодно и къде е капан',
    'Спестяваш — без реклами и без платени ревюта',
  ];
  // Височината се смята ПРЕДИ рисуване, за да не застъпи долния панел
  // (иначе дълга стъпка изяжда мястото на QR-а).
  const stepGap = 108;
  const wrappedSteps = steps.map((step) => wrap(step, W - 260, 34, false, 2));
  const stepsHeight = wrappedSteps.reduce(
    (sum, l) => sum + (l.length > 1 ? stepGap + 42 : stepGap),
    0
  );
  let stepY = Math.max(1120, 1462 - stepsHeight) + 34;
  wrappedSteps.forEach((stepLines, index) => {
    lines.push(
      `<circle cx="98" cy="${stepY - 12}" r="30" fill="${accent}22" stroke="${accent}" stroke-width="2"/>`
    );
    lines.push(
      `<text x="98" y="${stepY - 1}" font-family="DejaVu Sans" font-size="32" font-weight="bold" fill="${accent}" text-anchor="middle">${index + 1}</text>`
    );
    stepLines.forEach((line, i) => {
      lines.push(
        `<text x="152" y="${stepY + i * 44}" font-family="DejaVu Sans" font-size="34" fill="#E2E8F0">${esc(line)}</text>`
      );
    });
    stepY += stepLines.length > 1 ? stepGap + 42 : stepGap;
  });

  // --- Долен панел: как се влиза + QR
  const panelY = 1496;
  lines.push(
    `<rect x="64" y="${panelY}" width="${W - 128}" height="336" rx="40" fill="rgba(148,163,184,0.10)" stroke="rgba(148,163,184,0.22)" stroke-width="2"/>`
  );
  // Текстът в панела живее САМО в лявата част — QR-ът е отдясно и не бива
  // да закрива нищо (това беше реален дефект в първата версия).
  const panelTextWidth = W - 64 - 48 - 232 - 28 - 108;
  const panelTitle = wrap('Провери цената, преди да платиш', panelTextWidth, 34, true, 2);
  panelTitle.forEach((line, i) => {
    lines.push(
      `<text x="108" y="${panelY + 78 + i * 44}" font-family="DejaVu Sans" font-size="34" font-weight="bold" fill="#F8FAFC">${esc(line)}</text>`
    );
  });
  const panelAfterTitle = panelY + 78 + panelTitle.length * 44 + 16;

  lines.push(
    `<text x="108" y="${panelAfterTitle}" font-family="DejaVu Sans" font-size="32" fill="${CYAN}">${esc(publicBase().replace(/^https?:\/\//, ''))}</text>`
  );
  if (code) {
    lines.push(
      `<text x="108" y="${panelAfterTitle + 62}" font-family="DejaVu Sans" font-size="30" font-weight="bold" fill="${GOLD}">Код за покана: ${esc(code)}</text>`
    );
    lines.push(
      `<text x="108" y="${panelAfterTitle + 106}" font-family="DejaVu Sans" font-size="27" fill="${MUTED}">+100 точки за теб и приятеля ти</text>`
    );
  } else {
    lines.push(
      `<text x="108" y="${panelAfterTitle + 62}" font-family="DejaVu Sans" font-size="29" fill="${MUTED}">Без реклами. Без платени ревюта.</text>`
    );
    lines.push(
      `<text x="108" y="${panelAfterTitle + 104}" font-family="DejaVu Sans" font-size="29" fill="${MUTED}">Сваляш и ползваш безплатно.</text>`
    );
  }

  const qrSize = 232;
  const qrX = W - 64 - 48 - qrSize;
  const qrY = panelY + 52;
  lines.push(`<rect x="${qrX - 14}" y="${qrY - 14}" width="${qrSize + 28}" height="${qrSize + 28}" rx="22" fill="#E2E8F0"/>`);
  lines.push(qrPaths(qrTarget, qrX, qrY, qrSize));

  // --- Подпис
  lines.push(
    `<text x="72" y="${H - 60}" font-family="DejaVu Sans" font-size="28" fill="${FAINT}">SmartPrice · общност за честни цени</text>`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#08121F"/>
    <stop offset="0.55" stop-color="#0B1424"/>
    <stop offset="1" stop-color="#051520"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.26" r="0.78">
    <stop offset="0" stop-color="${accent}" stop-opacity="0.28"/>
    <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#34D399"/>
    <stop offset="1" stop-color="#10B981"/>
  </linearGradient>
</defs>
${lines.join('\n')}
</svg>`;
}

/** Рендира картата като PNG буфер (1080×1920). */
export async function renderStoryCard(input: StoryCardInput): Promise<Buffer> {
  const svg = buildSvg(input);
  // density: 72 → 1 SVG px = 1 PNG px, тоест точно 1080×1920 (Stories).
  // При друга стойност sharp мащабира (96 даваше 1440×2560).
  return sharp(Buffer.from(svg, 'utf8'), { density: 72 })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}
