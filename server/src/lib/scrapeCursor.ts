/**
 * 🧭 Курсор и категории за скрапера.
 *
 * Две неща, които правят обиколките „умни“, вместо да въртят едно и също:
 *   1. помним докъде сме стигнали в даден магазин (курсор);
 *   2. помним как сме превели чуждите категории към нашите.
 */
import { many, one, query } from '../db.js';

/* ------------------------------------------------------------------ курсор */

/** Откъде да започне следващата обиколка на този магазин. */
export async function currentCursor(domain: string): Promise<number> {
  const row = await one<{ cursor_offset: number }>(`select cursor_offset from scrape_cursors where domain = $1`, [domain]);
  return Number(row?.cursor_offset ?? 0);
}

/**
 * Отмества курсора напред.
 *
 * `span` е колко адреса имаше в листинга (за да се въртим в кръг, а не да растем
 * безкрайно). Ако не знаем колко е голям каталогът, ползваме `products.length`
 * като ориентир — важното е курсорът да не стои на едно място.
 */
export async function advanceCursor(domain: string, step: number, span?: number): Promise<number> {
  const move = Math.max(1, step);
  const size = Math.max(move, span && span > 0 ? span : move);
  const row = await one<{ cursor_offset: number }>(
    `insert into scrape_cursors (domain, cursor_offset, runs, last_span)
     values ($1, $2, 1, $3)
     on conflict (domain) do update set
       cursor_offset = (scrape_cursors.cursor_offset + $2) % greatest($3, 1),
       runs = scrape_cursors.runs + 1,
       last_span = $3,
       updated_at = now()
     returning cursor_offset`,
    [domain, move, size]
  );
  return Number(row?.cursor_offset ?? 0);
}

export interface CursorOverview {
  domain: string;
  cursor_offset: number;
  runs: number;
  last_span: number | null;
  updated_at: string | null;
}

/** За панела: къде сме в кой магазин. */
export async function listCursors(limit = 50): Promise<CursorOverview[]> {
  return many<CursorOverview>(
    `select c.domain, c.cursor_offset, c.runs, c.last_span, c.updated_at::text
       from scrape_cursors c
      order by c.updated_at desc
      limit $1`,
    [Math.max(1, Math.min(200, limit))]
  );
}

/* --------------------------------------------------------------- категории */

/** Нормализира име на категория, за да се сравняват „умно“. */
export function normalizeCategoryName(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[„“"'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Колко си приличат два низа (0..1) по думи. */
export function similarCategory(a: string, b: string): number {
  const wa = new Set(normalizeCategoryName(a).split(' ').filter((w) => w.length > 2));
  const wb = new Set(normalizeCategoryName(b).split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return (2 * common) / (wa.size + wb.size);
}

/**
 * Намира НАШАТА категория за чуждото име.
 *
 * Ред: точно съвпадение → най-близкото познато име (≥60% сходство) → нищо.
 * Така „Микровълнови фурни“ от един магазин и „Микровълнова фурна“ от друг
 * попадат на едно и също място, без да се създава нова категория.
 */
export async function lookupCategory(source: string): Promise<{ category: string; via: string } | null> {
  const norm = normalizeCategoryName(source);
  if (!norm || norm.length < 3) return null;

  const exact = await one<{ category: string }>(`select category from category_map where source = $1`, [norm]);
  if (exact) {
    await query(`update category_map set hits = hits + 1, updated_at = now() where source = $1`, [norm]);
    return { category: exact.category, via: 'точно' };
  }

  const all = await many<{ source: string; category: string }>(`select source, category from category_map limit 2000`);
  let best: { category: string; score: number } | null = null;
  for (const row of all) {
    const score = similarCategory(norm, row.source);
    if (score >= 0.6 && (!best || score > best.score)) best = { category: row.category, score };
  }
  if (best) {
    // Помним и това име, за да е точно следващия път.
    await rememberCategory(norm, best.category, false);
    return { category: best.category, via: `подобно (${Math.round(best.score * 100)}%)` };
  }
  return null;
}

/** Запомня чуждото име → наша категория (AI го е решил или сме го разпознали). */
export async function rememberCategory(source: string, category: string, countHit = true): Promise<void> {
  const norm = normalizeCategoryName(source);
  if (!norm || norm.length < 3 || !category) return;
  await query(
    `insert into category_map (source, category, hits)
     values ($1, $2, 1)
     on conflict (source) do update set
       category = excluded.category,
       hits = case when $3 then category_map.hits + 1 else category_map.hits end,
       updated_at = now()`,
    [norm, category, countHit]
  );
}

export interface CategoryMapRow {
  source: string;
  category: string;
  hits: number;
  updated_at: string | null;
}

export async function listCategoryMap(limit = 200): Promise<CategoryMapRow[]> {
  return many<CategoryMapRow>(
    `select source, category, hits, updated_at::text from category_map order by hits desc, source asc limit $1`,
    [Math.max(1, Math.min(1000, limit))]
  );
}

export async function deleteCategoryMap(source: string): Promise<void> {
  await query(`delete from category_map where source = $1`, [normalizeCategoryName(source)]);
}
