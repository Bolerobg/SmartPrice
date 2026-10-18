/**
 * 🏷️ ЧАСТНИ ОБЯВИ ОТ ПОТРЕБИТЕЛИ (платени).
 *
 * Как работи отстрани на човека:
 *   1. пуска обява (заглавие, снимки до 5, цена, град, състояние, контакт…);
 *   2. плаща 2 € и обявата стои 60 дни;
 *   3. като продаде — натиска „Продадено“ и тя се маха от списъка;
 *   4. ако не е продал — подновява с още 2 € за още 60 дни;
 *   5. в „Моите обяви“ вижда колко дни остават и цялата история.
 *
 * ЗАЩО ПЛАЩАНЕТО Е ПРЕЗ STRIPE: същият път като даренията (проверен на живо).
 * ВАЖНО: България вече е в евро и Stripe отказва BGN — затова сумата е в евро.
 *
 * ЧЕСТНОСТ: обява не става видима, докато не е платена. Не показваме „платено“
 * без потвърждение от Stripe (проверяваме сесията при връщане).
 */
import Stripe from 'stripe';
import { many, one, query } from '../db.js';
import { env, features } from '../env.js';
import { badRequest, notFound, unavailable } from '../lib/errors.js';
import { getSetting, setSetting } from './settings.js';

/* ============================================================ настройки */

export interface ListingConfig {
  /** Колко струва едно пускане/подновяване (евро). */
  priceEur: number;
  /** Колко дни стои една обява. */
  days: number;
  /** Максимум снимки на обява. */
  maxImages: number;
  /** Максимум активни обяви на човек (за да няма спам). */
  maxActive: number;
  /** Колко дни преди края да подсказваме за подновяване. */
  remindBeforeDays: number;
}

const CONFIG_KEY = 'listing_config';
const DEFAULT_CONFIG: ListingConfig = {
  priceEur: 2,
  days: 60,
  maxImages: 5,
  maxActive: 10,
  remindBeforeDays: 7,
};

export async function listingConfig(): Promise<ListingConfig> {
  try {
    const raw = await getSetting(CONFIG_KEY, '');
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<ListingConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setListingConfig(patch: Partial<ListingConfig>): Promise<ListingConfig> {
  const next = { ...(await listingConfig()), ...patch };
  next.priceEur = Math.max(0.5, Math.min(100, Number(next.priceEur) || 2));
  next.days = Math.max(7, Math.min(365, Number(next.days) || 60));
  next.maxImages = Math.max(1, Math.min(10, Number(next.maxImages) || 5));
  next.maxActive = Math.max(1, Math.min(100, Number(next.maxActive) || 10));
  next.remindBeforeDays = Math.max(0, Math.min(60, Number(next.remindBeforeDays) || 7));
  await setSetting(CONFIG_KEY, JSON.stringify(next));
  return next;
}

/* ============================================================ Stripe */

let stripeClient: Stripe | null = null;
function stripe(): Stripe {
  if (!features.payments) {
    throw unavailable('Плащанията не са конфигурирани (липсва STRIPE_SECRET_KEY).');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
  }
  return stripeClient;
}

/* ============================================================ типове */

export type ListingStatus = 'draft' | 'pending_payment' | 'active' | 'paused' | 'sold' | 'expired' | 'rejected';

export interface ListingRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  price_eur: number | null;
  is_negotiable: boolean;
  is_free: boolean;
  category: string;
  subcategory: string | null;
  city: string;
  neighborhood: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  item_condition: string;
  contact_phone: string | null;
  contact_note: string | null;
  handover: string;
  status: ListingStatus;
  days: number;
  paid_until: string | null;
  activated_at: string | null;
  sold_at: string | null;
  expires_at: string | null;
  price_paid_eur: number | null;
  renewals: number;
  views_count: number;
  saves_count: number;
  contacts_count: number;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
  images?: string[];
  /** Колко дни остават (изчислено) — за дашборда. null = без платен срок. */
  daysLeft?: number | null;
}

export interface ListingInput {
  title: string;
  description?: string;
  priceEur?: number | null;
  isNegotiable?: boolean;
  isFree?: boolean;
  category?: string;
  subcategory?: string | null;
  city: string;
  neighborhood?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  itemCondition?: string;
  contactPhone?: string | null;
  contactNote?: string | null;
  handover?: string;
  /** До 5 адреса на снимки (качени през /api/uploads). */
  images?: string[];
}

const CONDITIONS = ['new', 'like_new', 'used', 'for_parts'];
const HANDOVERS = ['pickup', 'shipping', 'both'];
const CATEGORIES = [
  'electronics',
  'home_garden',
  'kids',
  'clothes',
  'auto',
  'services',
  'sports',
  'pets',
  'other',
];

export const LISTING_CHOICES = {
  conditions: [
    { id: 'new', label: 'Ново' },
    { id: 'like_new', label: 'Като ново' },
    { id: 'used', label: 'Използвано' },
    { id: 'for_parts', label: 'За части' },
  ],
  handovers: [
    { id: 'pickup', label: 'Предаване на място' },
    { id: 'shipping', label: 'Изпращане с куриер' },
    { id: 'both', label: 'И двете' },
  ],
  categories: [
    { id: 'electronics', label: 'Електроника' },
    { id: 'home_garden', label: 'Дом и градина' },
    { id: 'kids', label: 'Деца и бебе' },
    { id: 'clothes', label: 'Дрехи и аксесоари' },
    { id: 'auto', label: 'Коли и части' },
    { id: 'services', label: 'Услуги' },
    { id: 'sports', label: 'Спорт и хоби' },
    { id: 'pets', label: 'Любимци' },
    { id: 'other', label: 'Друго' },
  ],
};

/** Дните, които остават до края на платения срок (може и отрицателно). */
function daysLeft(paidUntil: string | null): number | null {
  if (!paidUntil) return null;
  const end = Date.parse(paidUntil);
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000);
}

const SELECT_COLS = `id, user_id, title, description, price_eur::float as price_eur, is_negotiable, is_free,
  category, subcategory, city, neighborhood, address, latitude, longitude, item_condition,
  contact_phone, contact_note, handover, status, days, paid_until::text, activated_at::text,
  sold_at::text, expires_at::text, price_paid_eur::float as price_paid_eur, renewals,
  views_count, saves_count, contacts_count, reject_reason, created_at::text, updated_at::text`;

async function withImages(rows: ListingRow[]): Promise<ListingRow[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const imgs = await many<{ listing_id: string; url: string }>(
    `select listing_id, url from listing_images where listing_id = any($1::uuid[]) order by position asc`,
    [ids]
  ).catch(() => [] as Array<{ listing_id: string; url: string }>);
  const byId = new Map<string, string[]>();
  for (const i of imgs) {
    const list = byId.get(i.listing_id) ?? [];
    list.push(i.url);
    byId.set(i.listing_id, list);
  }
  return rows.map((r) => ({ ...r, images: byId.get(r.id) ?? [], daysLeft: daysLeft(r.paid_until) }));
}

/** Записва събитие в историята — това пълни „История“ в дашборда. */
export async function logEvent(listingId: string, userId: string | null, action: string, note?: string) {
  await query(
    `insert into listing_events (listing_id, user_id, action, note) values ($1,$2,$3,$4)`,
    [listingId, userId, action, note ?? null]
  ).catch(() => undefined);
}

/* ============================================================ създаване */

export async function createListing(userId: string, input: ListingInput): Promise<ListingRow> {
  const cfg = await listingConfig();
  const title = String(input.title ?? '').trim();
  if (title.length < 6) throw badRequest('Заглавието трябва да е поне 6 знака.');
  const city = String(input.city ?? '').trim();
  if (city.length < 2) throw badRequest('Напиши града.');

  const images = (input.images ?? []).filter((u) => typeof u === 'string' && /^https?:|^\//.test(u));
  if (images.length === 0) throw badRequest('Поне една снимка е задължителна.');
  if (images.length > cfg.maxImages) {
    throw badRequest(`Най-много ${cfg.maxImages} снимки на обява.`);
  }

  // Да не се трупат неограничени обяви от един човек.
  const active = await one<{ n: string }>(
    `select count(*)::text as n from listings
      where user_id = $1 and status in ('active','paused','pending_payment','draft')`,
    [userId]
  );
  if (Number(active?.n ?? 0) >= cfg.maxActive) {
    throw badRequest(
      `Имаш ${cfg.maxActive} обяви в процес. Продай или спри някоя, преди да пуснеш нова.`
    );
  }

  const isFree = input.isFree === true;
  const priceEur = isFree ? null : input.priceEur ?? null;
  if (!isFree && (priceEur === null || !Number.isFinite(Number(priceEur)) || Number(priceEur) < 0)) {
    throw badRequest('Напиши цена или отбележи „Подарявам“.');
  }

  const row = await one<ListingRow>(
    `insert into listings (user_id, title, description, price_eur, is_negotiable, is_free, category,
        subcategory, city, neighborhood, address, latitude, longitude, item_condition,
        contact_phone, contact_note, handover, status, days)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'draft',$18)
     returning ${SELECT_COLS}`,
    [
      userId,
      title.slice(0, 200),
      String(input.description ?? '').slice(0, 5000),
      isFree ? null : Number(priceEur),
      input.isNegotiable === true,
      isFree,
      CATEGORIES.includes(String(input.category)) ? input.category : 'other',
      String(input.subcategory ?? '').slice(0, 60) || null,
      city.slice(0, 80),
      String(input.neighborhood ?? '').slice(0, 80) || null,
      String(input.address ?? '').slice(0, 300) || null,
      Number.isFinite(Number(input.latitude)) ? Number(input.latitude) : null,
      Number.isFinite(Number(input.longitude)) ? Number(input.longitude) : null,
      CONDITIONS.includes(String(input.itemCondition)) ? input.itemCondition : 'used',
      String(input.contactPhone ?? '').slice(0, 40) || null,
      String(input.contactNote ?? '').slice(0, 500) || null,
      HANDOVERS.includes(String(input.handover)) ? input.handover : 'pickup',
      cfg.days,
    ]
  );
  if (!row) throw badRequest('Обявата не се записа.');

  for (let i = 0; i < images.length; i += 1) {
    await query(`insert into listing_images (listing_id, url, position) values ($1,$2,$3)`, [
      row.id,
      images[i],
      i,
    ]);
  }
  await logEvent(row.id, userId, 'created', 'Обявата е създадена като чернова — чака плащане.');
  return { ...row, images, daysLeft: null };
}

export async function updateListing(userId: string, id: string, input: Partial<ListingInput>): Promise<ListingRow> {
  const cur = await one<ListingRow>(`select ${SELECT_COLS} from listings where id = $1 and user_id = $2`, [
    id,
    userId,
  ]);
  if (!cur) throw notFound('Няма такава обява.');
  if (cur.status === 'sold') throw badRequest('Продадена обява не се редактира.');

  const cfg = await listingConfig();
  await query(
    `update listings set
       title = coalesce(nullif($3,''), title),
       description = coalesce($4, description),
       price_eur = coalesce($5, price_eur),
       is_negotiable = coalesce($6, is_negotiable),
       is_free = coalesce($7, is_free),
       category = coalesce(nullif($8,''), category),
       city = coalesce(nullif($9,''), city),
       neighborhood = coalesce($10, neighborhood),
       address = coalesce($11, address),
       item_condition = coalesce(nullif($12,''), item_condition),
       contact_phone = coalesce($13, contact_phone),
       contact_note = coalesce($14, contact_note),
       handover = coalesce(nullif($15,''), handover),
       updated_at = now()
     where id = $1 and user_id = $2`,
    [
      id,
      userId,
      String(input.title ?? '').trim().slice(0, 200),
      input.description === undefined ? null : String(input.description).slice(0, 5000),
      input.priceEur === undefined || input.priceEur === null ? null : Number(input.priceEur),
      input.isNegotiable === undefined ? null : Boolean(input.isNegotiable),
      input.isFree === undefined ? null : Boolean(input.isFree),
      String(input.category ?? ''),
      String(input.city ?? '').trim().slice(0, 80),
      input.neighborhood === undefined ? null : String(input.neighborhood ?? '').slice(0, 80) || null,
      input.address === undefined ? null : String(input.address ?? '').slice(0, 300) || null,
      String(input.itemCondition ?? ''),
      input.contactPhone === undefined ? null : String(input.contactPhone ?? '').slice(0, 40) || null,
      input.contactNote === undefined ? null : String(input.contactNote ?? '').slice(0, 500) || null,
      String(input.handover ?? ''),
    ]
  );

  // Снимките се сменят изцяло, ако са пратени (пак до максимума).
  if (Array.isArray(input.images)) {
    const images = input.images.filter((u) => typeof u === 'string' && /^https?:|^\//.test(u)).slice(0, cfg.maxImages);
    if (!images.length) throw badRequest('Поне една снимка е задължителна.');
    await query(`delete from listing_images where listing_id = $1`, [id]);
    for (let i = 0; i < images.length; i += 1) {
      await query(`insert into listing_images (listing_id, url, position) values ($1,$2,$3)`, [id, images[i], i]);
    }
  }

  await logEvent(id, userId, 'edited', 'Обявата е редактирана.');
  const fresh = await one<ListingRow>(`select ${SELECT_COLS} from listings where id = $1`, [id]);
  const [withImg] = await withImages(fresh ? [fresh] : []);
  return withImg;
}

/* ============================================================ плащане */

/**
 * Създава плащане в Stripe и запис в `listing_payments` (чака потвърждение).
 * Обявата НЕ става активна тук — чак след потвърждение от Stripe.
 */
export async function startListingCheckout(
  userId: string,
  listingId: string,
  kind: 'publish' | 'renew',
  /** Схемата за връщане в приложението (както е при даренията). */
  returnScheme = 'smartprice'
): Promise<{ checkoutUrl: string; sessionId: string; paymentId: string; amountEur: number }> {
  const cfg = await listingConfig();
  const listing = await one<ListingRow>(`select ${SELECT_COLS} from listings where id = $1 and user_id = $2`, [
    listingId,
    userId,
  ]);
  if (!listing) throw notFound('Няма такава обява.');
  if (listing.status === 'sold') throw badRequest('Тази обява вече е продадена.');
  if (listing.status === 'rejected') throw badRequest('Обявата е отказана от модератор.');
  if (kind === 'publish' && listing.status === 'active') {
    throw badRequest('Обявата вече е активна — ползвай „Поднови“.');
  }

  const client = stripe();
  const profile = await one<{ email: string }>('select email from profiles where id = $1', [userId]);
  if (!profile) throw notFound('Профилът не е намерен.');

  const currency = env.STRIPE_CURRENCY.toLowerCase();
  const amount = cfg.priceEur;
  const scheme = cleanScheme(returnScheme);
  const returnBase = `${scheme}://listing/result`;

  const session = await client.checkout.sessions.create({
    mode: 'payment',
    customer_email: profile.email,
    client_reference_id: userId,
    metadata: {
      app: 'SmartPrice',
      kind: 'listing',
      userId,
      listingId,
      days: String(cfg.days),
      amount: String(amount),
    },
    success_url: `${returnBase}?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnBase}?status=cancelled&listing_id=${listingId}`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: Math.round(amount * 100),
          product_data: {
            name: kind === 'renew' ? `SmartPrice — подновяване на обява (${cfg.days} дни)` : `SmartPrice — обява за ${cfg.days} дни`,
            description: String(listing.title).slice(0, 120),
          },
        },
      },
    ],
  });

  const payment = await one<{ id: string }>(
    `insert into listing_payments (user_id, listing_id, amount_eur, currency, days, kind,
        stripe_checkout_session_id, status)
     values ($1,$2,$3,$4,$5,$6,$7,'pending') returning id`,
    [userId, listingId, amount, currency.toUpperCase(), cfg.days, kind, session.id]
  );

  await query(`update listings set status = 'pending_payment', updated_at = now() where id = $1`, [listingId]);
  await logEvent(listingId, userId, 'checkout', `Отворено плащане за ${amount} € (${cfg.days} дни).`);

  return {
    checkoutUrl: String(session.url ?? ''),
    sessionId: session.id,
    paymentId: payment!.id,
    amountEur: amount,
  };
}

function cleanScheme(s: string): string {
  return /^[a-z][a-z0-9+.-]{1,30}$/.test(s) ? s : 'smartprice';
}

/**
 * Потвърждава плащането след връщане от Stripe.
 * Проверява РЕАЛНО при Stripe — не вярваме на клиента.
 */
export async function confirmListingPayment(
  sessionId: string
): Promise<{ ok: boolean; listingId?: string; paidUntil?: string; daysLeft?: number; reason?: string }> {
  const payment = await one<{
    id: string;
    user_id: string;
    listing_id: string;
    days: number;
    kind: string;
    status: string;
  }>(
    `select id, user_id, listing_id, days, kind, status from listing_payments
      where stripe_checkout_session_id = $1`,
    [sessionId]
  );
  if (!payment) return { ok: false, reason: 'Няма такова плащане.' };
  if (payment.status === 'paid') {
    const l = await one<ListingRow>(`select ${SELECT_COLS} from listings where id = $1`, [payment.listing_id]);
    return { ok: true, listingId: payment.listing_id, paidUntil: l?.paid_until ?? undefined, daysLeft: daysLeft(l?.paid_until ?? null) ?? undefined };
  }

  const client = stripe();
  let paid = false;
  let intentId: string | null = null;
  try {
    const session = await client.checkout.sessions.retrieve(sessionId);
    paid = session.payment_status === 'paid' || session.status === 'complete';
    intentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
    if (!paid && session.amount_total && session.payment_status !== 'unpaid') {
      paid = session.payment_status === 'paid';
    }
  } catch (err) {
    return { ok: false, reason: `Stripe не потвърди плащането: ${(err as Error).message}`.slice(0, 300) };
  }
  if (!paid) return { ok: false, reason: 'Плащането още не е пристигнало. Опитай пак след минута.' };

  const cfg = await listingConfig();
  const days = payment.days || cfg.days;
  const listing = await one<ListingRow>(`select ${SELECT_COLS} from listings where id = $1`, [payment.listing_id]);
  if (!listing) return { ok: false, reason: 'Обявата е изчезнала.' };

  // Подновяване: ако срокът още не е изтекъл, добавяме отгоре; иначе — от сега.
  const base = listing.paid_until && Date.parse(listing.paid_until) > Date.now() ? Date.parse(listing.paid_until) : Date.now();
  const paidUntil = new Date(base + days * 86_400_000);

  await query(
    `update listings set
       status = 'active',
       paid_until = $2,
       expires_at = $2,
       activated_at = coalesce(activated_at, now()),
       price_paid_eur = coalesce(price_paid_eur, $3) + case when $4 = 'renew' then $3 else 0 end,
       renewals = renewals + case when $4 = 'renew' then 1 else 0 end,
       days = $5,
       updated_at = now()
     where id = $1`,
    [payment.listing_id, paidUntil.toISOString(), cfg.priceEur, payment.kind, days]
  );
  await query(
    `update listing_payments set status = 'paid', paid_at = now(),
        stripe_payment_intent_id = coalesce(stripe_payment_intent_id, $2)
      where id = $1`,
    [payment.id, intentId]
  );
  await logEvent(
    payment.listing_id,
    payment.user_id,
    payment.kind === 'renew' ? 'renewed' : 'paid',
    payment.kind === 'renew'
      ? `Подновена за още ${days} дни (${cfg.priceEur} €).`
      : `Платено ${cfg.priceEur} € — обявата е активна до ${paidUntil.toLocaleDateString('bg-BG')}.`
  );

  return {
    ok: true,
    listingId: payment.listing_id,
    paidUntil: paidUntil.toISOString(),
    daysLeft: daysLeft(paidUntil.toISOString()) ?? undefined,
  };
}

/* ============================================================ жизнен цикъл */

export async function setListingStatus(
  userId: string,
  id: string,
  action: 'pause' | 'resume' | 'sold'
): Promise<ListingRow> {
  const listing = await one<ListingRow>(`select ${SELECT_COLS} from listings where id = $1 and user_id = $2`, [
    id,
    userId,
  ]);
  if (!listing) throw notFound('Няма такава обява.');

  if (action === 'pause') {
    if (listing.status !== 'active') throw badRequest('Само активна обява може да се спре.');
    await query(`update listings set status = 'paused', paused_at = now(), updated_at = now() where id = $1`, [id]);
    await logEvent(id, userId, 'paused', 'Спряна от продавача (за да не звънят напразно).');
  } else if (action === 'resume') {
    if (listing.status !== 'paused') throw badRequest('Тази обява не е спряна.');
    if (!listing.paid_until || Date.parse(listing.paid_until) < Date.now()) {
      throw badRequest('Платеният срок е изтекъл — поднови обявата.');
    }
    await query(`update listings set status = 'active', updated_at = now() where id = $1`, [id]);
    await logEvent(id, userId, 'resumed', 'Пусната отново.');
  } else {
    // Продадено: маха се от списъка, но остава в историята на човека.
    await query(
      `update listings set status = 'sold', sold_at = now(), updated_at = now() where id = $1`,
      [id]
    );
    await logEvent(id, userId, 'sold', 'Отбелязана като ПРОДАДЕНА от продавача.');
  }

  const fresh = await one<ListingRow>(`select ${SELECT_COLS} from listings where id = $1`, [id]);
  const [withImg] = await withImages(fresh ? [fresh] : []);
  return withImg;
}

/** Маркира изтеклите обяви. Вика се при всяко отваряне на дашборда и по график. */
export async function sweepExpired(): Promise<number> {
  const res = await query(
    `update listings set status = 'expired', updated_at = now()
      where status = 'active' and paid_until is not null and paid_until < now()`
  ).catch(() => null);
  return Number((res as { rowCount?: number } | null)?.rowCount ?? 0);
}

/* ============================================================ четене */

/** Моите обяви + история — за дашборда. */
export async function myListings(userId: string): Promise<{
  stats: { active: number; paused: number; sold: number; expired: number; drafts: number; spentEur: number; views: number };
  items: ListingRow[];
}> {
  await sweepExpired().catch(() => undefined);
  const rows = await many<ListingRow>(
    `select ${SELECT_COLS} from listings where user_id = $1 order by created_at desc limit 200`,
    [userId]
  );
  const items = await withImages(rows);
  const spent = await one<{ eur: string }>(
    `select coalesce(sum(amount_eur),0)::text as eur from listing_payments where user_id = $1 and status = 'paid'`,
    [userId]
  );
  const count = (s: string) => items.filter((i) => i.status === s).length;
  return {
    stats: {
      active: count('active'),
      paused: count('paused'),
      sold: count('sold'),
      expired: count('expired'),
      drafts: items.filter((i) => i.status === 'draft' || i.status === 'pending_payment').length,
      spentEur: Number(spent?.eur ?? 0),
      views: items.reduce((n, i) => n + (i.views_count ?? 0), 0),
    },
    items,
  };
}

/** Историята на една обява (за екрана с подробности). */
export async function listingHistory(listingId: string, userId: string) {
  const events = await many<{ action: string; note: string | null; created_at: string }>(
    `select action, note, created_at::text from listing_events where listing_id = $1 order by created_at desc limit 50`,
    [listingId]
  );
  const payments = await many<{
    amount_eur: number;
    days: number;
    kind: string;
    status: string;
    paid_at: string | null;
    created_at: string;
  }>(
    `select amount_eur::float as amount_eur, days, kind, status, paid_at::text, created_at::text
       from listing_payments where listing_id = $1 and user_id = $2 order by created_at desc limit 50`,
    [listingId, userId]
  );
  return { events, payments };
}

/** Публичен списък с активни обяви (за браузване). */
export async function publicListings(params: {
  q?: string;
  city?: string;
  category?: string;
  maxPrice?: number;
  minPrice?: number;
  sort?: 'recent' | 'cheap' | 'expensive';
  limit?: number;
  offset?: number;
}): Promise<{ total: number; items: ListingRow[] }> {
  await sweepExpired().catch(() => undefined);
  const where: string[] = [`status = 'active'`, `(paid_until is null or paid_until > now())`];
  const args: unknown[] = [];
  const p = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (params.q) {
    const like = `%${params.q}%`;
    const i = p(like);
    where.push(`(title ilike ${i} or description ilike ${i})`);
  }
  if (params.city) where.push(`city = ${p(params.city)}`);
  if (params.category) where.push(`category = ${p(params.category)}`);
  if (Number.isFinite(params.maxPrice)) where.push(`(price_eur is null or price_eur <= ${p(params.maxPrice)})`);
  if (Number.isFinite(params.minPrice)) where.push(`(price_eur is null or price_eur >= ${p(params.minPrice)})`);

  const sort =
    params.sort === 'cheap'
      ? 'price_eur asc nulls last'
      : params.sort === 'expensive'
        ? 'price_eur desc nulls last'
        : 'created_at desc';
  const limit = Math.max(1, Math.min(60, params.limit ?? 30));
  const offset = Math.max(0, Math.min(5000, params.offset ?? 0));

  const rows = await many<ListingRow>(
    `select ${SELECT_COLS} from listings where ${where.join(' and ')} order by ${sort} limit ${limit} offset ${offset}`,
    args
  );
  const total = await one<{ n: string }>(
    `select count(*)::text as n from listings where ${where.join(' and ')}`,
    args
  );
  return { total: Number(total?.n ?? 0) || 0, items: await withImages(rows) };
}

/** Една обява за показване: само активна и в платен срок. */
export async function getPublicListing(id: string): Promise<ListingRow | null> {
  await sweepExpired().catch(() => undefined);
  const row = await one<ListingRow>(
    `select ${SELECT_COLS} from listings
      where id = $1 and status = 'active' and (paid_until is null or paid_until > now())`,
    [id]
  );
  if (!row) return null;
  const [withImg] = await withImages([row]);
  return withImg ?? null;
}

export async function bumpListingViews(id: string): Promise<void> {
  await query(`update listings set views_count = views_count + 1 where id = $1`, [id]).catch(() => undefined);
}

/* ============================================================ подкана (купувач → продавач) */

const NUDGE_COOLDOWN_DAYS = 14;

/**
 * Трябва ли да покажем на този човек красивия модел „и ти можеш да продаваш“.
 *
 * Нарочно НЕ досаждаме:
 *   • не питаме току-що регистрираните (първо да видят какво е приложението);
 *   • не питаме някого, който ВЕЧЕ има обяви (той го знае);
 *   • не питаме пак, преди да мине уговореният срок;
 *   • ако е изключил подканите — никога повече.
 */
export async function listingNudge(userId: string): Promise<{
  show: boolean;
  reason: string;
  cooldownDays: number;
  off: boolean;
}> {
  const profile = await one<{
    created_at: string;
    listing_nudge_off: boolean;
    listing_nudge_until: string | null;
    listing_nudge_seen: number;
    posts_count: number | null;
  }>(
    `select p.created_at::text, p.listing_nudge_off, p.listing_nudge_until::text, p.listing_nudge_seen,
            (select count(*)::int from posts where author_id = p.id) as posts_count
       from profiles p where p.id = $1`,
    [userId]
  );
  if (!profile) return { show: false, reason: 'Няма профил.', cooldownDays: NUDGE_COOLDOWN_DAYS, off: false };
  if (profile.listing_nudge_off) {
    return { show: false, reason: 'Изключено от човека.', cooldownDays: NUDGE_COOLDOWN_DAYS, off: true };
  }
  const ageDays = (Date.now() - Date.parse(profile.created_at)) / 86_400_000;
  if (ageDays < 3) return { show: false, reason: 'Твърде нов профил.', cooldownDays: NUDGE_COOLDOWN_DAYS, off: false };

  const mine = await one<{ n: string }>(`select count(*)::text as n from listings where user_id = $1`, [userId]);
  if (Number(mine?.n ?? 0) > 0) {
    return { show: false, reason: 'Вече има собствени обяви.', cooldownDays: NUDGE_COOLDOWN_DAYS, off: false };
  }
  if (profile.listing_nudge_until && Date.parse(profile.listing_nudge_until) > Date.now()) {
    return { show: false, reason: 'Скоро е показван.', cooldownDays: NUDGE_COOLDOWN_DAYS, off: false };
  }
  // Искаме човекът да е поне малко активен — да е разглеждал оферти.
  if (Number(profile.posts_count ?? 0) === 0 && Number(profile.listing_nudge_seen) === 0) {
    return { show: false, reason: 'Още не е разглеждал.', cooldownDays: NUDGE_COOLDOWN_DAYS, off: false };
  }
  return { show: true, reason: 'Може да покажем подканата.', cooldownDays: NUDGE_COOLDOWN_DAYS, off: false };
}

export async function markNudgeSeen(userId: string): Promise<void> {
  await query(
    `update profiles set listing_nudge_seen = listing_nudge_seen + 1,
        listing_nudge_until = now() + ($2 || ' days')::interval
      where id = $1`,
    [userId, String(NUDGE_COOLDOWN_DAYS)]
  ).catch(() => undefined);
}

export async function setNudgeOff(userId: string, off: boolean): Promise<void> {
  await query(`update profiles set listing_nudge_off = $2 where id = $1`, [userId, off]).catch(() => undefined);
}

/* ============================================================ админ */

export async function adminListingsInfo() {
  await sweepExpired().catch(() => undefined);
  const [totals, byStatus, revenue, recent, top] = await Promise.all([
    one<{ n: string; active: string; sold: string }>(
      `select count(*)::text as n,
              count(*) filter (where status = 'active')::text as active,
              count(*) filter (where status = 'sold')::text as sold
         from listings`
    ),
    many<{ status: string; n: string }>(`select status, count(*)::text as n from listings group by 1 order by 2 desc`),
    one<{ today: string; month: string; all_time: string; payments: string }>(
      `select
         coalesce(sum(amount_eur) filter (where paid_at::date = current_date), 0)::text as today,
         coalesce(sum(amount_eur) filter (where paid_at > now() - interval '30 days'), 0)::text as month,
         coalesce(sum(amount_eur), 0)::text as all_time,
         count(*)::text as payments
       from listing_payments where status = 'paid'`
    ),
    many<{
      id: string;
      title: string;
      city: string;
      status: string;
      price_eur: number | null;
      paid_until: string | null;
      views_count: number;
      created_at: string;
      user_email: string;
    }>(
      `select l.id, l.title, l.city, l.status, l.price_eur::float as price_eur, l.paid_until::text,
              l.views_count, l.created_at::text, p.email as user_email
         from listings l left join profiles p on p.id = l.user_id
        order by l.created_at desc limit 60`
    ),
    many<{ city: string; n: string }>(
      `select city, count(*)::text as n from listings where status = 'active' group by 1 order by 2 desc limit 10`
    ),
  ]);

  return {
    config: await listingConfig(),
    totals: {
      all: Number(totals?.n ?? 0),
      active: Number(totals?.active ?? 0),
      sold: Number(totals?.sold ?? 0),
    },
    byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.n) })),
    revenue: {
      todayEur: Number(revenue?.today ?? 0),
      monthEur: Number(revenue?.month ?? 0),
      allTimeEur: Number(revenue?.all_time ?? 0),
      payments: Number(revenue?.payments ?? 0),
    },
    recent,
    topCities: top.map((r) => ({ city: r.city, count: Number(r.n) })),
  };
}

/** Модератор маха обява (напр. измама). Връща парите ръчно — не тук. */
export async function adminTakeDown(id: string, reason: string): Promise<void> {
  await query(
    `update listings set status = 'rejected', reject_reason = $2, updated_at = now() where id = $1`,
    [id, reason.slice(0, 300)]
  );
  await logEvent(id, null, 'rejected', `Махната от модератор: ${reason.slice(0, 200)}`);
}

/* ============================================================ демо на пъзела */

const PUZZLE_NUDGE_COOLDOWN_HOURS = 48;

/** Трябва ли да подканим човека да тренира пъзела (демото). */
export async function puzzleDemoNudge(userId: string | null): Promise<{
  show: boolean;
  seen: number;
  bestMs: number | null;
  reason: string;
}> {
  if (!userId) return { show: true, seen: 0, bestMs: null, reason: 'Гост — показваме демото.' };
  const row = await one<{
    puzzle_demo_nudge_off: boolean;
    puzzle_demo_nudge_until: string | null;
    puzzle_demo_plays: number;
    puzzle_demo_best_ms: number | null;
  }>(
    `select puzzle_demo_nudge_off, puzzle_demo_nudge_until::text, puzzle_demo_plays, puzzle_demo_best_ms
       from profiles where id = $1`,
    [userId]
  );
  if (!row) return { show: false, seen: 0, bestMs: null, reason: 'Няма профил.' };
  if (row.puzzle_demo_nudge_off) {
    return { show: false, seen: row.puzzle_demo_plays, bestMs: row.puzzle_demo_best_ms, reason: 'Изключено от човека.' };
  }
  if (row.puzzle_demo_nudge_until && Date.parse(row.puzzle_demo_nudge_until) > Date.now()) {
    return { show: false, seen: row.puzzle_demo_plays, bestMs: row.puzzle_demo_best_ms, reason: 'Скоро е показвано.' };
  }
  return { show: true, seen: row.puzzle_demo_plays, bestMs: row.puzzle_demo_best_ms, reason: 'Може да покажем демото.' };
}

export async function recordPuzzleDemo(
  userId: string | null,
  data: { ms?: number; plays?: number }
): Promise<{ plays: number; bestMs: number | null }> {
  if (!userId) return { plays: Number(data.plays ?? 0), bestMs: data.ms ?? null };
  await query(
    `update profiles set
        puzzle_demo_plays = puzzle_demo_plays + 1,
        puzzle_demo_best_ms = least(coalesce(puzzle_demo_best_ms, 999999999), coalesce($2, puzzle_demo_best_ms, 999999999)),
        puzzle_demo_nudge_until = now() + ($3 || ' hours')::interval
      where id = $1`,
    [userId, data.ms ?? null, String(PUZZLE_NUDGE_COOLDOWN_HOURS)]
  ).catch(() => undefined);
  const row = await one<{ puzzle_demo_plays: number; puzzle_demo_best_ms: number | null }>(
    `select puzzle_demo_plays, puzzle_demo_best_ms from profiles where id = $1`,
    [userId]
  );
  return { plays: row?.puzzle_demo_plays ?? 0, bestMs: row?.puzzle_demo_best_ms ?? null };
}

export async function setPuzzleNudgeOff(userId: string, off: boolean): Promise<void> {
  await query(`update profiles set puzzle_demo_nudge_off = $2 where id = $1`, [userId, off]).catch(() => undefined);
}
