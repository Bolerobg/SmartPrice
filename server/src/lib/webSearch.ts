/**
 * Търсене в Google през Apify — за намиране на НОВИ магазини.
 *
 * Защо: безплатните търсачки (Mojeek, DuckDuckGo, Bing) връщат шум — форуми,
 * Reddit, mastodon — и пропускат истинските български магазини. Google дава
 * точните резултати, но не може да се чете директно (блокира автомати).
 * Затова ползваме готовия актьор на Apify: `apify~google-search-scraper`.
 *
 * Пари: плаща се на резултат, един въпрос ≈ $0.005. Затова минаваме през
 * дневния бюджет на Apify (както всичко останало) и записваме разхода.
 *
 * Честност: ако бюджетът е изчерпан, няма токен или актьорът върне грешка —
 * връщаме празен списък. Търсенето просто продължава с безплатните търсачки.
 */
import { apifyToken, apifyBudgetAllows, addApifySpend } from './apifyBrowser.js';

const ACTOR = 'apify~google-search-scraper';

export interface WebHit {
  title: string;
  url: string;
  description?: string;
}

/** Колко струва един въпрос (консервативна оценка за бюджета). */
const ESTIMATE_USD = 0.02;

interface SerpItem {
  organicResults?: Array<{ title?: string; url?: string; description?: string }>;
  paidResults?: Array<{ title?: string; url?: string }>;
}

/**
 * Търси в Google и връща органичните резултати.
 * @param query въпросът, както би го написал човек
 * @param limit колко резултата да върне (10 = една страница)
 */
export async function googleSearch(query: string, limit = 10): Promise<WebHit[]> {
  const q = String(query ?? '').trim().slice(0, 200);
  if (!q) return [];

  const token = await apifyToken().catch(() => '');
  if (!token) return [];

  // Не харчим, ако дневният лимит е стигнат.
  const budget = await apifyBudgetAllows(ESTIMATE_USD).catch(() => ({ allowed: false }));
  if (!budget.allowed) return [];

  const api = async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
    const res = await fetch(`https://api.apify.com/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`apify ${res.status}`);
    return res.json();
  };

  try {
    const started = (await api(`/acts/${ACTOR}/runs?token=${encodeURIComponent(token)}`, 'POST', {
      queries: q,
      maxPagesPerQuery: 1,
      resultsPerPage: Math.max(10, Math.min(20, limit)),
      countryCode: 'bg',
      languageCode: 'bg',
      // Само органични резултати — рекламите ни пречат.
      focusOnPaidAds: false,
    })) as { data?: { id?: string } };
    const runId = started?.data?.id;
    if (!runId) return [];

    // Чакаме до ~100 сек (Google отговаря за 10–30 сек).
    let status = 'RUNNING';
    let datasetId = '';
    let spend = 0;
    for (let i = 0; i < 25; i += 1) {
      await new Promise((r) => setTimeout(r, 4_000));
      const run = (await api(`/actor-runs/${runId}`)) as {
        data?: { status?: string; defaultDatasetId?: string; usageTotalUsd?: number };
      };
      status = run?.data?.status ?? 'RUNNING';
      datasetId = run?.data?.defaultDatasetId ?? '';
      spend = run?.data?.usageTotalUsd ?? 0;
      if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) break;
    }
    // Записваме разхода и при провал — иначе бюджетът излиза от синхрон.
    if (spend > 0) await addApifySpend(spend, `Google търсене: ${q.slice(0, 40)}`).catch(() => undefined);
    if (status !== 'SUCCEEDED' || !datasetId) return [];

    const items = (await api(`/datasets/${datasetId}/items?limit=3`)) as SerpItem[];
    const hits: WebHit[] = [];
    for (const item of Array.isArray(items) ? items : []) {
      for (const r of item?.organicResults ?? []) {
        if (r?.url) hits.push({ title: r.title ?? r.url, url: r.url, description: r.description });
      }
    }
    return hits.slice(0, limit);
  } catch {
    return [];
  }
}
