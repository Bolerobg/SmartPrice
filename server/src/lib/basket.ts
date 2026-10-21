/**
 * 🛒 Сравнение на ЦЯЛ списък за покупки по вериги.
 *
 * Идеята (от сайта-източник, но с нашите данни): човекът въвежда списък
 * („прясно мляко“, „сирене 400 г“, „банани“) и вижда колко би струвал:
 *   • във всяка верига поотделно (и колко продукта от списъка има там),
 *   • в най-изгодната ЕДНА верига,
 *   • в най-изгодната ДВОЙКА вериги (един продукт от едната, друг от другата).
 *
 * Защо смятаме в Node, а не в SQL: мачването на продукти е смислово („МЛЯКО
 * ПРЯСНО ВЕРЕЯ 3% 1 Л“ = „ПРЯСНО МЛЯКО ВЕРЕЯ 3% 1Л“), а базата е с C колация
 * (кирилицата не се сгъва от lower()). Ползваме същите правила като при
 * Ценовия дуел (`isSameProduct`, `sizeCompatible`), за да не твърдим, че
 * „сирене 200 г“ и „сирене 400 г“ са едно и също.
 */
import { many } from '../db.js';
import { isSameProduct, productTokens } from './priceDuel.js';

export interface BasketItemInput {
  title: string;
  quantity?: number;
}

export interface BasketMatch {
  chain: string;
  price: number;
  offerTitle: string;
  postId: string;
}

export interface BasketRow {
  title: string;
  quantity: number;
  /** Най-доброто (най-евтиното) предложение за продукта — за показване. */
  cheapest: BasketMatch | null;
  /** По една цена на верига (само веригите, които имат този продукт). */
  perChain: BasketMatch[];
}

export interface ChainTotal {
  chain: string;
  /** Колко струват намерените продукти в тази верига. */
  total: number;
  /** Колко продукта от списъка има в тази верига. */
  found: number;
  /** Колко продукта липсват (за честност — не „всичко е налично“). */
  missing: number;
}

export interface BasketPairTotal {
  chains: [string, string];
  total: number;
  found: number;
  missing: number;
}

export interface BasketComparison {
  city: string | null;
  rows: BasketRow[];
  /** По верига, подредени от най-евтината. */
  chains: ChainTotal[];
  /** Най-изгодната една верига, в която има поне `minCoverage` от продуктите. */
  best: ChainTotal | null;
  /** Най-изгодната двойка вериги (ако покрива повече продукти от една верига). */
  bestPair: BasketPairTotal | null;
  itemsTotal: number;
  /** Ако двойката е по-добра от едната верига — колко се спестява. */
  pairSaving: number | null;
}

interface CandidateRow {
  id: string;
  title: string;
  price: number;
  chain: string;
}

/** Взима всички внесени цени в един град по думите от списъка. */
async function loadChainOffers(city: string | null, words: string[]): Promise<CandidateRow[]> {
  const clean = Array.from(new Set(words.filter((w) => w.length >= 4))).slice(0, 40);
  if (!clean.length) return [];
  const patterns = clean.map((w) => `%${w}%`);
  return many<CandidateRow>(
    `select p.id::text as id, p.title, p.price_paid::float as price, p.place_name as chain
       from posts p
      where p.status = 'published'
        and p.price_paid > 0
        and p.platform_tag = 'Супермаркет'
        and ($1::text is null or lower(p.city) = lower($1))
        and (sp_fold(p.title) like any($2::text[]) or p.title ilike any($2::text[]))
      limit 4000`,
    [city, patterns]
  );
}

export async function compareBasket(
  items: BasketItemInput[],
  city: string | null,
  opts?: { minCoverage?: number }
): Promise<BasketComparison> {
  const wanted = items
    .map((i) => ({
      title: String(i.title ?? '').trim().slice(0, 120),
      quantity: Math.max(1, Math.min(99, Number(i.quantity ?? 1) || 1)),
    }))
    .filter((i) => i.title.length >= 2)
    .slice(0, 40);

  const empty: BasketComparison = {
    city,
    rows: [],
    chains: [],
    best: null,
    bestPair: null,
    itemsTotal: 0,
    pairSaving: null,
  };
  if (!wanted.length) return empty;

  const allWords = wanted.flatMap((i) => productTokens(i.title).slice(0, 3));
  const candidates = await loadChainOffers(city, allWords);
  const withTokens = candidates.map((c) => ({ row: c, tokens: productTokens(c.title) }));

  const rows: BasketRow[] = [];
  for (const item of wanted) {
    const tokens = productTokens(item.title);
    if (!tokens.length) {
      rows.push({ ...item, cheapest: null, perChain: [] });
      continue;
    }
    // По верига пазим НАЙ-ЕВТИНОТО съвпадение (иначе една скъпа марка вдига сметката).
    const perChain = new Map<string, BasketMatch>();
    for (const c of withTokens) {
      if (!isSameProduct(tokens, c.tokens)) continue;
      const match: BasketMatch = {
        chain: c.row.chain,
        price: c.row.price,
        offerTitle: c.row.title,
        postId: c.row.id,
      };
      const prev = perChain.get(match.chain);
      if (!prev || match.price < prev.price) perChain.set(match.chain, match);
    }
    const list = Array.from(perChain.values()).sort((a, b) => a.price - b.price);
    rows.push({ ...item, cheapest: list[0] ?? null, perChain: list });
  }

  // Сметката по верига: за всяка верига сумираме нейната цена за всеки продукт,
  // който има. Броим и липсващите — за да не изглежда, че „всичко е налично“.
  const chainNames = new Set<string>();
  for (const row of rows) for (const m of row.perChain) chainNames.add(m.chain);

  const totals = new Map<string, ChainTotal>();
  for (const name of chainNames) {
    let total = 0;
    let found = 0;
    for (const row of rows) {
      const m = row.perChain.find((x) => x.chain === name);
      if (!m) continue;
      total += m.price * row.quantity;
      found += 1;
    }
    totals.set(name, {
      chain: name,
      total: Number(total.toFixed(2)),
      found,
      missing: rows.length - found,
    });
  }

  // Подредба: първо по покритие (да не печели верига с 1 продукт), после по цена.
  const chains = Array.from(totals.values()).sort(
    (a, b) => b.found - a.found || a.total - b.total
  );
  const minCoverage = Math.max(1, Math.min(rows.length, Number(opts?.minCoverage ?? Math.ceil(rows.length * 0.6)) || 1));
  const eligible = chains.filter((c) => c.found >= minCoverage);
  const best =
    (eligible.length ? eligible.slice().sort((a, b) => a.total - b.total) : chains.slice().sort((a, b) => a.total - b.total))[0] ??
    null;

  // Най-изгодна ДВОЙКА: за всеки продукт взимаме по-евтиното от двете вериги.
  let bestPair: BasketPairTotal | null = null;
  const names = chains.map((c) => c.chain);
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      let total = 0;
      let found = 0;
      for (const row of rows) {
        const a = row.perChain.find((x) => x.chain === names[i]);
        const b = row.perChain.find((x) => x.chain === names[j]);
        const pick = a && b ? (a.price <= b.price ? a : b) : (a ?? b);
        if (!pick) continue;
        total += pick.price * row.quantity;
        found += 1;
      }
      if (found < rows.length) continue; // двойката трябва да покрива ЦЕЛИЯ списък
      const cand: BasketPairTotal = {
        chains: [names[i], names[j]],
        total: Number(total.toFixed(2)),
        found,
        missing: 0,
      };
      if (!bestPair || cand.total < bestPair.total) bestPair = cand;
    }
  }

  return {
    city,
    rows,
    chains: chains.slice(0, 12),
    best,
    bestPair,
    itemsTotal: rows.length,
    pairSaving:
      bestPair && best && bestPair.total < best.total
        ? Number((best.total - bestPair.total).toFixed(2))
        : null,
  };
}
