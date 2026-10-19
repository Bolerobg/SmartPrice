/**
 * 🔎 ПЪРВО ДОКОСВАНЕ (откъде е дошъл човекът).
 *
 * Записва се ВЕДНЪЖ, при първото отваряне на приложението:
 *   • utm_source / utm_medium / utm_campaign — от рекламния линк (?utm_source=facebook…)
 *   • referrer — кой сайт го е пратил (само ако е друг домейн)
 *   • landing — на кой екран е кацнал
 *
 * Пази се в localStorage, защото човек обикновено се регистрира по-късно,
 * не в първата секунда. При регистрация се праща към сървъра.
 *
 * Работи само на web; на телефон (Expo) връща празно — там няма referrer.
 */
import { Platform } from 'react-native';

export interface FirstTouch {
  source?: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
  landing?: string;
}

const KEY = 'sp_first_touch';

function web(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && !!window.location;
}

/** Разпознава канала по адреса на препращащия сайт (ако няма utm_source). */
export function channelFromHost(host: string): string {
  const h = String(host || '').toLowerCase();
  if (!h) return 'direct';
  if (h.includes('google') || h.includes('bing') || h.includes('duckduckgo') || h.includes('yahoo')) return 'search';
  if (h.includes('facebook') || h.includes('fb.')) return 'facebook';
  if (h.includes('instagram')) return 'instagram';
  if (h.includes('tiktok')) return 'tiktok';
  if (h.includes('viber')) return 'viber';
  if (h.includes('whatsapp') || h.includes('wa.me')) return 'whatsapp';
  if (h.includes('youtube')) return 'youtube';
  if (h.includes('mail') || h.includes('gmail')) return 'email';
  return 'referral';
}

/**
 * Отбелязва първото докосване. Вика се веднъж при стартиране на приложението.
 * Ако вече има запис — не се пипа (първото докосване е истината).
 */
export function captureFirstTouch(): void {
  if (!web()) return;
  try {
    if (window.localStorage.getItem(KEY)) return;

    const url = new URL(window.location.href);
    const q = url.searchParams;
    const utmSource = (q.get('utm_source') || '').trim().slice(0, 60);
    const utmMedium = (q.get('utm_medium') || '').trim().slice(0, 60);
    const utmCampaign = (q.get('utm_campaign') || '').trim().slice(0, 80);

    // Кой сайт го е пратил — само външен домейн (иначе е наш own линк).
    let referrer = '';
    try {
      const ref = document.referrer || '';
      if (ref) {
        const host = new URL(ref).hostname;
        if (host && host !== window.location.hostname) referrer = host.slice(0, 120);
      }
    } catch {
      referrer = '';
    }

    const source = utmSource || channelFromHost(referrer);
    const payload: FirstTouch = {
      source,
      medium: utmMedium || (referrer ? 'referral' : 'direct'),
      campaign: utmCampaign || undefined,
      referrer: referrer || undefined,
      landing: (url.pathname || '/').slice(0, 120),
    };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // статистиката никога не бива да чупи приложението
  }
}

/** Връща записаното първо докосване (за пращане при регистрация). */
export function firstTouch(): FirstTouch | undefined {
  if (!web()) return undefined;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as FirstTouch;
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
