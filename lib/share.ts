/**
 * Споделяне на оферта навсякъде.
 *
 * Проблемът, който решаваме: `Share.share()` от react-native-web работи само
 * ако браузърът има `navigator.share` (главно мобилен Safari/Chrome). На
 * десктоп Chrome/Edge няма → Promise-ът се отхвърля, а старият код го
 * поглъщаше с празен `catch` → бутонът „Сподели“ не правеше нищо.
 * Освен това старото споделяне пращаше САМО текст, без линк — получателят
 * не можеше да отвори офертата.
 *
 * Сега: винаги има публичен линк към офертата + готови бутони за конкретни
 * приложения, а системното споделяне е само една от опциите.
 */
import { Linking, Platform, Share } from 'react-native';
import { formatPostedAtLong } from '@/src/lib/format';
import type { PostItem } from '@/types';

/** Публичният адрес на приложението (за линкове, които се пращат навън). */
export function publicBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_APP_URL || process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && /^https?:\/\//.test(fromEnv)) return fromEnv.replace(/\/+$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://smartprice.bg';
}

/** Линк към конкретна оферта. */
export function postUrl(id: string): string {
  return `${publicBaseUrl()}/post/${id}`;
}

export function postVerdict(post: PostItem): string {
  return post.polarity === 'green'
    ? '🟢 ТОП НАХОДКА'
    : '🔴 ЧЕРВЕН ФЛАГ — НЕ ХОДИ!';
}

export function buildShareTitle(post: PostItem): string {
  // За онлайн оферти не показваме името на сайта — само „Онлайн магазин“.
  return `${postVerdict(post)} · ${post.sourceUrl ? 'Онлайн магазин' : post.placeName}`;
}

/** Кратък, четим текст за споделяне. */
export function buildShareText(post: PostItem): string {
  const lines = [
    `${postVerdict(post)} в SmartPrice`,
    post.sourceUrl ? '📍 Онлайн магазин' : `📍 ${post.placeName} (${post.city})`,
    `💬 ${post.title}`,
    `💳 Платено: ${post.pricePaid.toFixed(2)} ${post.currency}`,
  ];

  // Уникалният ID на офертата: човекът, който получи линка, може да я намери и
  // като напише този код в търсачката на приложението.
  if (post.code) lines.push(`🔖 ID на офертата: ${post.code} (търси по него в приложението)`);

  const postedAt = formatPostedAtLong(post.createdAt);
  if (postedAt) lines.push(`🗓 Офертата е сложена ${postedAt}`);

  if (post.referencePrice && post.referencePrice > post.pricePaid) {
    const saved = post.referencePrice - post.pricePaid;
    lines.push(`💰 Спестени: ${saved.toFixed(2)} ${post.currency}`);
  }
  if (post.receipt) lines.push('🧾 Доказано с касова бележка');
  lines.push('');
  lines.push('Виж офертата 👇');

  return lines.join('\n');
}

/** Целият текст, който отива при получателя (текст + линк). */
export function buildShareMessage(post: PostItem): string {
  return `${buildShareText(post)}\n${postUrl(post.id)}`;
}

export interface ShareTarget {
  key: string;
  label: string;
  color: string;
  icon: string;
  /** Връща URL, който отваря приложението с готовото съобщение. */
  build: (url: string, text: string) => string;
}

export const SHARE_TARGETS: ShareTarget[] = [
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    color: '#25D366',
    icon: 'logo-whatsapp',
    build: (url, text) => `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`,
  },
  {
    key: 'viber',
    label: 'Viber',
    color: '#7360F2',
    icon: 'call',
    build: (url, text) => `viber://forward?text=${encodeURIComponent(`${text}\n${url}`)}`,
  },
  {
    key: 'telegram',
    label: 'Telegram',
    color: '#229ED9',
    icon: 'paper-plane',
    build: (url, text) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    color: '#1877F2',
    icon: 'logo-facebook',
    build: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    key: 'messenger',
    label: 'Messenger',
    color: '#0084FF',
    icon: 'chatbubbles',
    build: (url, text) =>
      `https://www.facebook.com/dialog/send?link=${encodeURIComponent(url)}` +
      `&app_id=291494419107518&redirect_uri=${encodeURIComponent(url)}` +
      `&quote=${encodeURIComponent(text)}`,
  },
  {
    key: 'x',
    label: 'X',
    color: '#0F172A',
    icon: 'logo-twitter',
    build: (url, text) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    key: 'email',
    label: 'Имейл',
    color: '#F59E0B',
    icon: 'mail',
    build: (url, text) =>
      `mailto:?subject=${encodeURIComponent('Оферта от SmartPrice')}` +
      `&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
  },
  {
    key: 'sms',
    label: 'SMS',
    color: '#34D399',
    icon: 'chatbox-ellipses',
    build: (url, text) => `sms:?&body=${encodeURIComponent(`${text}\n${url}`)}`,
  },
];

/** Има ли системен share диалог (мобилен браузър / native)? */
export function hasSystemShare(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof navigator === 'undefined') return false;
  return typeof (navigator as Navigator).share === 'function';
}

/** Отваря системния диалог за споделяне. Хвърля, ако не е наличен. */
export async function shareViaSystem(post: PostItem): Promise<void> {
  const message = buildShareMessage(post);
  if (Platform.OS !== 'web') {
    await Share.share({ message, url: postUrl(post.id), title: buildShareTitle(post) });
    return;
  }
  const nav = navigator as Navigator & {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  };
  if (typeof nav.share !== 'function') {
    throw new Error('Системното споделяне не се поддържа в този браузър.');
  }
  await nav.share({ title: buildShareTitle(post), text: buildShareText(post), url: postUrl(post.id) });
}

/**
 * Отваря конкретно приложение с произволен линк + текст.
 * Ползва се и за покани (там няма пост, но каналите са същите).
 */
export async function openShareTargetRaw(
  target: ShareTarget,
  url: string,
  text: string
): Promise<void> {
  const targetUrl = target.build(url, text);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  const can = await Linking.canOpenURL(targetUrl).catch(() => false);
  if (!can) throw new Error(`${target.label} не е инсталиран на устройството.`);
  await Linking.openURL(targetUrl);
}

/** Отваря конкретно приложение с готовото съобщение. */
export async function openShareTarget(target: ShareTarget, post: PostItem): Promise<void> {
  const url = target.build(postUrl(post.id), buildShareText(post));
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const can = await Linking.canOpenURL(url).catch(() => false);
  if (!can) throw new Error(`${target.label} не е инсталиран на устройството.`);
  await Linking.openURL(url);
}

/**
 * Готовият текст за покана на приятел (код + линк + какво печелят двамата).
 * „Двойни точки“ трябва да е ЯСНО казано — иначе поканата изглежда като реклама.
 */
export function buildInviteMessage(link: string, points = 100): string {
  return [
    'Провери цената, преди да платиш 🛒',
    'SmartPrice е безплатно приложение, в което хора качват реални цени и касови бележки —',
    'без реклами и без платени ревюта.',
    '',
    `Влез по моя код и ДВАМАТА получаваме по ${points} точки доверие (двойно):`,
    link,
  ].join('\n');
}

/**
 * Споделя САМАТА КАРТИНКА (PNG „Спестих X €“) — за Stories, Viber, WhatsApp.
 *
 * На web: сваля я като файл (и през системния share, ако браузърът поддържа
 * файлове — мобилен Safari/Chrome го правят, така качването в Stories е 2 клика).
 * На native: отваря системния диалог с линка към картата, откъдето се запазва.
 */
export async function shareStoryCard(
  cardUrl: string,
  message: string
): Promise<'shared' | 'downloaded' | 'opened'> {
  if (Platform.OS !== 'web') {
    await Share.share({ message, url: cardUrl, title: 'Моята карта от SmartPrice' });
    return 'opened';
  }

  // 1) Мобилен браузър: истинско споделяне на ФАЙЛА (най-краткият път към Stories).
  try {
    const response = await fetch(cardUrl);
    if (response.ok) {
      const blob = await response.blob();
      const file = new File([blob], 'smartprice-karta.png', { type: 'image/png' });
      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
        share?: (data: { files?: File[]; text?: string; title?: string }) => Promise<void>;
      };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: message, title: 'Моята карта от SmartPrice' });
        return 'shared';
      }

      // 2) Иначе — сваляме я (после се качва в Stories от галерията).
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'smartprice-karta.png';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      return 'downloaded';
    }
  } catch {
    // пада към долния вариант
  }

  // 3) Последен вариант: отваряме картата в нов раздел (дълго натискане = запази).
  if (typeof window !== 'undefined') window.open(cardUrl, '_blank', 'noopener,noreferrer');
  return 'opened';
}

/** Копира произволен линк (ползва се и за покани). */
export async function copyText(link: string): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      if (typeof window !== 'undefined' && typeof window.focus === 'function') window.focus();
      await navigator.clipboard.writeText(link);
      return true;
    }
  } catch {
    // пада към резервния вариант
  }
  if (typeof document !== 'undefined') {
    try {
      const area = document.createElement('textarea');
      area.value = link;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '0';
      area.style.left = '0';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.focus();
      area.select();
      area.setSelectionRange(0, link.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

/** Копира линка. Връща true при успех. */
export async function copyPostLink(post: PostItem): Promise<boolean> {
  const link = postUrl(post.id);

  if (Platform.OS !== 'web') return false; // виж бележката най-долу

  // 1) Модерният Clipboard API. Изисква страницата да е на фокус — затова
  //    първо я фокусираме (иначе хвърля „Document is not focused“).
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      if (typeof window !== 'undefined' && typeof window.focus === 'function') {
        window.focus();
      }
      await navigator.clipboard.writeText(link);
      return true;
    }
  } catch {
    // пада към резервния вариант долу
  }

  // 2) Стар резервен вариант — работи и без разрешение за clipboard.
  if (typeof document !== 'undefined') {
    try {
      const area = document.createElement('textarea');
      area.value = link;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '0';
      area.style.left = '0';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.focus();
      area.select();
      area.setSelectionRange(0, link.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      if (ok) return true;
    } catch {
      // продължаваме към провал
    }
  }

  // На native няма вграден clipboard без допълнителен пакет — там системният
  // share диалог вече има „Копирай“, затова не добавяме зависимост само за това.
  return false;
}
