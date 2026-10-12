/**
 * Форматиране за показване. Датите идват от сървъра като ISO низове
 * и се превръщат в човешки вид на български — както беше в дизайна
 * („Току-що“, „Днес“, „Вчера“), но вече от реални данни.
 */

export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'Току-що';
  if (diffMin < 60) return `Преди ${diffMin} мин.`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Преди ${diffHours} ч.`;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  if (date >= startOfToday) return 'Днес';
  if (date >= startOfYesterday) return 'Вчера';

  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 7) return `Преди ${diffDays} дни`;

  return date.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatMoney(amount: number, currency = '€'): string {
  if (!Number.isFinite(amount)) return `0.00 ${currency}`;
  return `${amount.toFixed(2)} ${currency}`;
}

const BG_MONTHS = [
  'януари', 'февруари', 'март', 'април', 'май', 'юни',
  'юли', 'август', 'септември', 'октомври', 'ноември', 'декември',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function parseIso(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Точната дата на офертата: 12.10.2026 */
export function formatPostDate(iso: string | undefined | null): string {
  const d = parseIso(iso);
  if (!d) return '';
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Дата с час: 12.10.2026, 14:35 */
export function formatPostDateTime(iso: string | undefined | null): string {
  const d = parseIso(iso);
  if (!d) return '';
  return `${formatPostDate(iso)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * „Кога е сложена офертата“ — четимо и НЕдвусмислено.
 * Скорошните получават „Днес/Вчера“ + час, по-старите — точна дата,
 * защото „Преди 12 дни“ не казва на човек кой ден е било.
 */
export function formatPostedAt(iso: string | undefined | null): string {
  const d = parseIso(iso);
  if (!d) return '';

  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  if (d >= startOfToday) return `Днес, ${time} ч.`;
  if (d >= startOfYesterday) return `Вчера, ${time} ч.`;

  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays < 7) return `${formatPostDate(iso)} (преди ${diffDays} дни)`;

  if (d.getFullYear() !== new Date().getFullYear()) {
    return `${d.getDate()} ${BG_MONTHS[d.getMonth()]} ${d.getFullYear()} г.`;
  }
  return formatPostDate(iso);
}

/** Описателен вид за екрана на офертата: „сложена на 12.10.2026 в 14:35 ч.“ */
export function formatPostedAtLong(iso: string | undefined | null): string {
  const d = parseIso(iso);
  if (!d) return '';
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  if (d >= startOfToday) return `днес в ${time} ч.`;
  if (d >= startOfYesterday) return `вчера в ${time} ч.`;
  if (d.getFullYear() !== new Date().getFullYear()) {
    return `на ${d.getDate()} ${BG_MONTHS[d.getMonth()]} ${d.getFullYear()} г. в ${time} ч.`;
  }
  return `на ${formatPostDate(iso)} в ${time} ч.`;
}

/** Компактно число за броячи (18420 → „18 420“). */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('bg-BG');
}

/** Етикет на мерната единица, както се показва на потребителя. */
export function unitLabel(unitType?: string): string {
  switch (unitType) {
    case 'g':
    case 'kg':
      return 'кг';
    case 'ml':
    case 'l':
      return 'л';
    case 'pcs':
      return 'бр.';
    default:
      return '';
  }
}

export function formatPricePerUnit(price: number, unitType?: string): string {
  const label = unitLabel(unitType);
  return label ? `${price.toFixed(2)} €/${label}` : `${price.toFixed(2)} €`;
}

/** Колко стара е една цена (за „потвърдена днес“). */
export function isToday(iso: string | undefined | null): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return date >= startOfToday;
}
