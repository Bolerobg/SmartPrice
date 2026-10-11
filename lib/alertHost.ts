/**
 * Alert, който РАБОТИ и в браузъра.
 *
 * Проблемът: `Alert.alert()` в react-native-web е празна функция —
 * `class Alert { static alert() {} }`. Затова на телефона (web билда)
 * ВСИЧКИ съобщения и потвърждения се губеха безшумно: „Излез от профила“
 * не правеше нищо, грешките при качване не се виждаха, разрешенията за
 * камера не питаха.
 *
 * Решението: на web подменяме `Alert.alert` с наша реализация, която
 * показва красив модал в стила на приложението (без native browser popup).
 * На iOS/Android остава истинският Alert.
 *
 * Модалът се рендира от <AlertHost/>, който е монтиран в app/_layout.tsx.
 */
import { Alert, Platform } from 'react-native';

export interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface AlertRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
}

type Handler = (req: AlertRequest) => void;

let handler: Handler | null = null;
let counter = 0;

/** <AlertHost/> се регистрира тук, за да може да показва модалите. */
export function setAlertHandler(next: Handler | null): void {
  handler = next;
}

/** Показва съобщение. Извиква се вместо Alert.alert на web. */
export function showAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[]
): void {
  const list: AlertButton[] =
    buttons && buttons.length > 0 ? buttons : [{ text: 'Добре', style: 'default' }];

  const req: AlertRequest = { id: ++counter, title, message, buttons: list };

  if (handler) {
    handler(req);
    return;
  }
  // Резерва, ако по някаква причина host-ът още не е монтиран.
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert([title, message].filter(Boolean).join('\n\n'));
    const fallback = list.find((b) => b.style !== 'cancel') ?? list[0];
    fallback?.onPress?.();
  }
}

// На web подменяме вградената (празна) функция. Прави се еднократно при
// зареждане на модула, а app/_layout.tsx го импортира най-рано.
if (Platform.OS === 'web') {
  (Alert as unknown as { alert: typeof showAlert }).alert = showAlert;
}
