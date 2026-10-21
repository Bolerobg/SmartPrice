/**
 * 🧓 ЛЕСЕН РЕЖИМ — „едър дизайн“ за възрастни хора и хора, които не са
 * свикнали с приложения.
 *
 * Как работи:
 *   • флагът се пази в localStorage (на телефон — в паметта на приложението,
 *     докато е отворено) и се чете навсякъде през useEasyMode();
 *   • всяка смяна уведомява всички екрани веднага (без презареждане), за да
 *     види човекът резултата още докато държи пръста си на превключвателя;
 *   • ПО ПОДРАЗБИРАНЕ Е ВКЛЮЧЕН — това е новият дизайн на приложението.
 *     Който иска стария (дребен) изглед, го изключва от „Профил“ и изборът
 *     му се помни.
 *
 * Защо изобщо превключвател, а не просто нов дизайн: старият изглед показва
 * повече информация на екран (повече оферти за минута) и някои хора са му
 * свикнали. Затова оставяме и двата, с ясно ВКЛ/ИЗКЛ — никой не губи нищо.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

const KEY = 'sp_easy_mode';

/** Наблюдатели: екраните, които чакат смяната, за да се пречертаят. */
const listeners = new Set<() => void>();

/**
 * Текуща стойност. Пазим я и в паметта, за да е една и съща за всички екрани
 * (иначе единият може да чете старо, а другият ново състояние).
 */
let cached: boolean | null = null;

function readStored(): boolean | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === 'on') return true;
    if (raw === 'off') return false;
  } catch {
    /* няма достъп до хранилището — работим с подразбирането */
  }
  return null;
}

function writeStored(value: boolean): void {
  if (Platform.OS !== 'web') return;
  try {
    window.localStorage.setItem(KEY, value ? 'on' : 'off');
  } catch {
    /* нищо лошо не се случва — просто няма да се помни между отварянията */
  }
}

/** Включен ли е едрият дизайн. */
export function isEasyMode(): boolean {
  if (cached === null) {
    const stored = readStored();
    cached = stored === null ? true : stored;
  }
  return cached;
}

/** Включва/изключва едрия дизайн и уведомява екраните. */
export function setEasyMode(value: boolean): void {
  if (isEasyMode() === value) return;
  cached = value;
  writeStored(value);
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* един счупен екран не бива да спира останалите */
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Куката, която екраните ползват: `const easy = useEasyMode();`
 * Пречертава се сам, щом човекът натисне превключвателя.
 */
export function useEasyMode(): boolean {
  return useSyncExternalStore(subscribe, isEasyMode, isEasyMode);
}
