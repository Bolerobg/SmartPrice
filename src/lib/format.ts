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
