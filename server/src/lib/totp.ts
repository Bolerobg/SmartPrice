/**
 * 🔐 TOTP (RFC 6238) за двуфакторна защита на админа — без външни библиотеки.
 * Съвместим с Google Authenticator / Authy / 1Password (6 цифри, 30 сек, SHA-1).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const PERIOD = 30;

/** Нова тайна: 20 случайни байта → 32 знака база32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[=\s-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Кодът за даден момент (по подразбиране — сега). */
export function totpCode(secret: string, atMs: number = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(atMs / 1000 / PERIOD) + stepOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Проверка с толеранс ±1 стъпка (30 сек назад/напред) — за закъснели часовници. */
export function verifyTotp(secret: string, code: string, atMs: number = Date.now()): boolean {
  const clean = String(code ?? '').replace(/\D/g, '');
  if (clean.length !== DIGITS) return false;
  for (const offset of [0, -1, 1]) {
    const expected = Buffer.from(totpCode(secret, atMs, offset));
    const given = Buffer.from(clean);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

/** Адресът за QR кода в приложението-автентикатор. */
export function totpUri(email: string, secret: string, issuer = 'SmartPrice'): string {
  const label = encodeURIComponent(issuer + ':' + email);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD) });
  return 'otpauth://totp/' + label + '?' + params.toString();
}
