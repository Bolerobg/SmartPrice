/**
 * Сметки върху историята на цената на една оферта.
 *
 * Идеята: офертата не е снимка, а жива цена. Някой я е сложил, после хора са
 * ходили на място и са я потвърдили или поправили. Оттук излизат нещата,
 * които карат потребителя да ѝ вярва и да иска да помогне:
 *   • колко е поскъпнала / поевтиняла от първоначалното,
 *   • кога за последно някой е проверявал на място („прясна“ ли е),
 *   • колко души са участвали.
 */
import type { PostItem, PriceHistoryPoint } from '@/types';

export interface PriceHistoryEntry extends PriceHistoryPoint {
  /** Разлика спрямо предходната записана цена (0 за първата). */
  delta: number;
  /** Първа запис в историята. */
  isFirst: boolean;
}

export interface PriceStats {
  /** Първата известна цена („откъде тръгна“). */
  initialPrice: number;
  /** Текущата цена — тази, която виждаме в офертата. */
  currentPrice: number;
  /** current - initial (положително = поскъпнало). */
  delta: number;
  /** Същото в проценти спрямо първата цена. */
  deltaPercent: number;
  direction: 'up' | 'down' | 'same';
  /** Колко пъти цената реално се е променила. */
  changesCount: number;
  /** Колко пъти някой е потвърдил, че цената е същата. */
  confirmationsCount: number;
  /** Колко различни души са се занимавали с цената. */
  contributorsCount: number;
  /** Последна промяна на цената. */
  lastChangeAt?: string;
  /** Последна проверка на място (потвърждение или промяна). */
  lastCheckedAt?: string;
  /** Дни от последната проверка. null = никога не е проверявана. */
  daysSinceCheck: number | null;
  /** Прясна ли е цената (проверена преди ≤ 7 дни). */
  isFresh: boolean;
  /** Историята от най-старото към най-новото, с пресметнати разлики. */
  entries: PriceHistoryEntry[];
  /** Има ли смисъл да показваме блок „история“ (има поне едно събитие). */
  hasHistory: boolean;
}

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/** Сглобява пълната картина на цената от суровите записи. */
export function computePriceStats(post: PostItem): PriceStats {
  const raw = (post.priceHistory ?? []).slice().sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  // Някои оферти (стари или внесени) нямат записи — тогава историята е
  // просто „толкова, колкото е била при качването“.
  const source: PriceHistoryPoint[] =
    raw.length > 0
      ? raw
      : [
          {
            id: `synthetic-${post.id}`,
            price: post.pricePaid,
            recordedAt: post.createdAt,
            reportedBy: post.author?.name ?? 'SmartPrice',
            status: 'initial',
          },
        ];

  let previous = source[0]!.price;
  const entries: PriceHistoryEntry[] = source.map((point, index) => {
    const delta = index === 0 ? 0 : Number((point.price - previous).toFixed(2));
    previous = point.price;
    return { ...point, delta, isFirst: index === 0 };
  });

  const initialPrice = entries[0]!.price;
  const currentPrice = post.pricePaid;
  const delta = Number((currentPrice - initialPrice).toFixed(2));
  const deltaPercent =
    initialPrice > 0 ? Number(((delta / initialPrice) * 100).toFixed(0)) : 0;

  const changesCount = entries.filter((e) => e.status === 'changed').length;
  const confirmationsCount = entries.filter((e) => e.status === 'confirmed').length;

  const contributors = new Set(
    entries
      .map((e) => e.reportedBy)
      .filter((name) => Boolean(name) && name !== 'SmartPrice')
  );

  const lastChange = [...entries].reverse().find((e) => e.status === 'changed');
  const lastCheck = [...entries]
    .reverse()
    .find((e) => e.status === 'confirmed' || e.status === 'changed');

  const lastCheckedAt = lastCheck?.recordedAt ?? post.lastVerifiedAt;
  const days = daysSince(lastCheckedAt);

  return {
    initialPrice,
    currentPrice,
    delta,
    deltaPercent,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
    changesCount,
    confirmationsCount,
    contributorsCount: contributors.size,
    lastChangeAt: lastChange?.recordedAt,
    lastCheckedAt,
    daysSinceCheck: days,
    isFresh: days !== null && days <= 7,
    entries,
    hasHistory: entries.length > 1 || changesCount > 0 || confirmationsCount > 0,
  };
}

/** Кратък текст за посоката на цената — за баджове. */
export function priceTrendLabel(stats: PriceStats): string | null {
  if (stats.direction === 'same') return null;
  const abs = Math.abs(stats.delta).toFixed(2);
  return stats.direction === 'down' ? `↓ ${abs} € по-евтино` : `↑ ${abs} € по-скъпо`;
}

/**
 * „преди 3 дни“ / „днес“ / „никога“.
 *
 * `online` = офертата е от онлайн магазин: тогава не „проверена на място“, а
 * „проверена в сайта“ — човек не ходи никъде, отваря продукта.
 */
export function freshnessLabel(stats: PriceStats, online = false, chain = false): string {
  /**
   * 🛒 Цена, внесена от каталозите на веригите: не е „на място“ и не е „в сайта“
   * на магазина — сверяваме я ние, от каталозите на веригите. Затова трети, честен
   * изказ („сверена от SmartPrice“), вместо „проверена от никого“.
   */
  if (chain) {
    if (stats.daysSinceCheck === null) return 'сверена от SmartPrice';
    if (stats.daysSinceCheck === 0) return 'сверена днес';
    if (stats.daysSinceCheck === 1) return 'сверена вчера';
    return `сверена преди ${stats.daysSinceCheck} дни`;
  }
  if (stats.daysSinceCheck === null) return 'още не е проверявана';
  const where = online ? ' в сайта' : ' на място';
  if (stats.daysSinceCheck === 0) return online ? 'проверена днес в сайта' : 'проверена днес';
  if (stats.daysSinceCheck === 1) return `проверена вчера${where}`;
  return `проверена преди ${stats.daysSinceCheck} дни${where}`;
}

/** Описание на едно събитие в историята — човешки, с посока. */
export function entryLabel(entry: PriceHistoryEntry, online = false, chain = false): {
  title: string;
  icon: string;
  color: 'blue' | 'green' | 'amber';
} {
  if (entry.isFirst) {
    return { title: 'Първоначална цена', icon: 'pricetag-outline', color: 'blue' };
  }
  if (entry.status === 'confirmed') {
    return {
      title: chain
        ? 'Потвърдена от SmartPrice'
        : online
          ? 'Потвърдена в сайта'
          : 'Потвърдена на място',
      icon: 'checkmark-circle',
      color: 'green',
    };
  }
  if (entry.delta > 0) {
    return {
      title: `Поскъпна с ${entry.delta.toFixed(2)} €`,
      icon: 'trending-up',
      color: 'amber',
    };
  }
  if (entry.delta < 0) {
    return {
      title: `Поевтиня с ${Math.abs(entry.delta).toFixed(2)} €`,
      icon: 'trending-down',
      color: 'green',
    };
  }
  return { title: 'Цената се промени', icon: 'swap-horizontal', color: 'amber' };
}
