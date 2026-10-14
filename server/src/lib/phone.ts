/**
 * Телефонен номер — една единствена точка за нормализация и проверка.
 *
 * Защо: номерът е това, което гарантира „един човек = един акаунт“.
 * Затова формата трябва да е ЕДНАКЪВ навсякъде, иначе „088 123 4567“ и
 * „+359881234567“ минават като два различни номера и правилото се заобикаля.
 *
 * Нормализиран вид: само цифри, международен формат без „+“, напр.
 *   359881234567  (359 + 9 цифри)
 */

/** Приема каквото потребителят напише. Връща нормализиран номер или null. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let d = raw.replace(/[^0-9]/g, '');
  if (!d) return null;

  // 00 359... (международен префикс)
  if (d.startsWith('00')) d = d.slice(2);

  if (d.startsWith('359')) {
    // вече е в международен вид
  } else if (d.startsWith('0')) {
    // национален вид с водеща нула: 0881234567 -> 359881234567
    d = `359${d.slice(1)}`;
  } else if (d.length === 9) {
    // без водеща нула: 881234567 -> 359881234567
    d = `359${d}`;
  }

  // Български номер: 359 + 8 или 9 цифри (мобилни са 35988… / 35989…).
  if (!/^359\d{8,9}$/.test(d)) return null;
  return d;
}

/** Човешки вид за показване: 359881234567 -> +359 88 123 4567 */
export function formatPhone(normalized: string | null | undefined): string {
  if (!normalized) return '';
  const d = normalized.replace(/[^0-9]/g, '');
  if (!d.startsWith('359')) return `+${d}`;
  const rest = d.slice(3);
  const groups = rest.match(/.{1,3}/g) ?? [];
  return `+359 ${groups.join(' ')}`.trim();
}
