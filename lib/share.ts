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
import type { PostItem } from '@/types';

/** Публичният адрес на приложението (за линкове, които се пращат навън). */
export function publicBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && /^https?:\/\//.test(fromEnv)) return fromEnv.replace(/\/+$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://smart.lookthis.online';
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
  return `${postVerdict(post)} · ${post.placeName}`;
}

/** Кратък, четим текст за споделяне. */
export function buildShareText(post: PostItem): string {
  const lines = [
    `${postVerdict(post)} в SmartPrice`,
    `📍 ${post.placeName} (${post.city})`,
    `💬 ${post.title}`,
    `💳 Платено: ${post.pricePaid.toFixed(2)} ${post.currency}`,
  ];

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
