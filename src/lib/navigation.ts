/**
 * ↩️ Връщане назад, което ВИНАГИ работи.
 *
 * Защо съществува: когато някой отвори екран ПО ПРЯК ЛИНК — споделен пост,
 * известие, презареждане на страницата в браузъра — историята на навигацията е
 * празна и `router.back()` не прави НИЩО. Човекът остава „заклещен“ и стрелката
 * изглежда счупена (точно това се случи с екрана на офертата).
 *
 * Тук: ако има история — връщаме се; ако няма — отиваме на началния екран.
 */
/**
 * Описваме само това, което ни трябва — expo-router v57 не изнася тип `Router`,
 * а и така функцията работи с всяка версия.
 */
interface NavRouter {
  back: () => void;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  replace: (href: any) => void;
  canGoBack?: () => boolean;
}

export function goBack(router: NavRouter): void {
  try {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
  } catch {
    /* някои версии хвърлят, ако няма история — падаме към началния екран */
  }
  router.replace('/' as never);
}

export default goBack;
