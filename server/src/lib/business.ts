/**
 * 🏢 „Търговец в SmartPrice“ — втората страна на приложението.
 *
 * Досега хората внасяха цени, а търговецът нямаше глас. Тук той заявява
 * „това е моят обект“, доказва го с ЕИК и получава право на ОФИЦИАЛЕН отговор
 * под сигналите за неговия обект.
 *
 * ВАЖНО: обектът се разпознава по СЪЩИЯ слуг като в `v_objects` —
 *   md5(lower(btrim(place_name)) || '|' || lower(btrim(city)))
 * Ако някога се смени формулата в миграция 036, трябва да се смени и тук.
 */
import { many, one, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';

/**
 * Профилите (`profiles.id`) и офертите (`posts.id`) в SmartPrice са UUID —
 * НЕ числови. Затова външните ключове тук са `uuid`, а не `bigint` (грешка,
 * която веднъж спря API-то: „foreign key constraint cannot be implemented“).
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 💰 План „Проверен търговец“ — 19 € на месец.
 *
 * Защо точно това разделение: регистрацията и ПЪРВИЯТ отговор всеки месец са
 * безплатни (за да влезе търговецът и да види ползата), а неограничените
 * отговори, офертите и статистиката са платени. 19 € е под цената на един
 * обяд — търговецът не го мисли, а за нас се събира без да плаши хората.
 */
export const PLAN_PRICE_EUR = 19;
export const PLAN_MONTHS = 1;
/** Безплатният план включва толкова официални отговора на месец. */
export const FREE_REPLIES_PER_MONTH = 1;

/** Само цифри — ЕИК идва от касова бележка с интервали и водещи нули. */
export function normalizeTaxId(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

export interface BusinessPublic {
  id: string;
  venue_slug: string;
  place_name: string;
  city: string | null;
  legal_name: string;
  /** ✅ Проверен търговец (одобрен от админ или автоматично по ЕИК). */
  verified: boolean;
  tier: 'free' | 'verified';
  /** До кога е платено (Фаза 2). null = без абонамент. */
  paid_until: string | null;
  /** Има ли право да пише официални отговори точно сега. */
  can_reply: boolean;
  /** 💰 Платен абонамент, който е активен в момента. */
  plan_active: boolean;
}

export interface BusinessMine extends BusinessPublic {
  status: 'pending' | 'verified' | 'rejected';
  tax_id: string | null;
  contact_email: string;
  contact_phone: string | null;
  auto_approved: boolean;
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  replies_count: number;
}

interface Row {
  id: string;
  owner_user_id: string;
  venue_slug: string;
  place_name: string;
  city: string | null;
  legal_name: string;
  tax_id: string | null;
  contact_email: string;
  contact_phone: string | null;
  proof_url: string | null;
  status: 'pending' | 'verified' | 'rejected';
  tier: 'free' | 'verified';
  paid_until: Date | string | null;
  auto_approved: boolean;
  reject_reason: string | null;
  reviewed_at: Date | string | null;
  reviewed_by: string | null;
  created_at: Date | string;
}

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/** Платеният абонамент е активен (Фаза 2 го пълни; засега винаги false). */
function hasActivePlan(row: Pick<Row, 'tier' | 'paid_until'>): boolean {
  if (row.tier !== 'verified') return false;
  if (!row.paid_until) return false;
  return new Date(row.paid_until).getTime() > Date.now();
}

function toPublic(row: Row): BusinessPublic {
  return {
    id: row.id,
    venue_slug: row.venue_slug,
    place_name: row.place_name,
    city: row.city,
    legal_name: row.legal_name,
    verified: row.status === 'verified',
    tier: row.tier,
    paid_until: iso(row.paid_until),
    // Право на отговор: проверен търговец винаги може (Фаза 1 е безплатна).
    // Броят на отговорите се пази в `addBusinessReply` (безплатно = 1/месец).
    can_reply: row.status === 'verified',
    plan_active: hasActivePlan(row),
  };
}

/** Обектът съществува ли (има поне един публикуван сигнал)? */
async function venueExists(slug: string): Promise<{ place_name: string; city: string | null } | null> {
  return one<{ place_name: string; city: string | null }>(
    `select place_name, city from v_objects where slug = $1`,
    [slug]
  );
}

/**
 * Автоматично доказателство по ЕИК: съвпада ли с ЕИК от касова бележка,
 * която вече е разчетена от AI за СЪЩИЯ обект. Това е най-силното доказателство
 * — човекът не може да го измисли, защото идва от негов собствен бон.
 */
async function taxIdMatchesVenue(slug: string, taxId: string): Promise<boolean> {
  if (taxId.length < 9) return false;
  const row = await one<{ n: string }>(
    `select count(*)::text as n
       from posts p
       join receipts r on r.post_id = p.id
      where p.status = 'published'
        and md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) = $1
        and regexp_replace(coalesce(r.merchant_tax_id, ''), '\\D', '', 'g') = $2`,
    [slug, taxId]
  );
  return Number(row?.n ?? 0) > 0;
}

export interface ClaimInput {
  userId: string;
  venueSlug: string;
  legalName: string;
  taxId?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  proofUrl?: string | null;
}

export interface ClaimResult {
  business: BusinessMine;
  /** true = одобрено веднага по ЕИК; false = чака преглед от екипа. */
  autoApproved: boolean;
}

/**
 * Заявка „това е моят обект“. Ако ЕИК съвпадне с касова бележка на обекта →
 * одобряваме веднага. Иначе остава 'pending' за преглед от админ.
 */
export async function claimBusiness(input: ClaimInput): Promise<ClaimResult> {
  const slug = String(input.venueSlug ?? '').trim();
  if (!/^[0-9a-f]{32}$/.test(slug)) throw badRequest('Невалиден обект.');

  const venue = await venueExists(slug);
  if (!venue) throw notFound('Такъв обект няма в приложението. Първо качи находка от него.');

  const taxId = normalizeTaxId(input.taxId);
  if (taxId && (taxId.length < 9 || taxId.length > 13)) {
    throw badRequest('ЕИК трябва да е 9 или 13 цифри.');
  }

  // Вече проверен търговец на този обект → не може втори.
  const taken = await one<{ legal_name: string }>(
    `select legal_name from business_accounts where venue_slug = $1 and status = 'verified'`,
    [slug]
  );
  if (taken) {
    throw conflict(
      `Този обект вече е заявен от „${taken.legal_name}“. Ако смяташ, че е грешка, пиши ни.`
    );
  }

  const existing = await one<{ id: string; status: string }>(
    `select id, status from business_accounts where owner_user_id = $1 and venue_slug = $2`,
    [input.userId, slug]
  );
  if (existing && existing.status === 'verified') {
    throw conflict('Ти вече си провереният търговец на този обект.');
  }

  const auto = taxId ? await taxIdMatchesVenue(slug, taxId) : false;

  const saved = await tx(async (client) => {
    const res = await client.query<{ id: string }>(
      `insert into business_accounts
         (owner_user_id, venue_slug, place_name, city, legal_name, tax_id,
          contact_email, contact_phone, proof_url, status, auto_approved,
          reviewed_at, reviewed_by, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       on conflict (owner_user_id, venue_slug) do update set
         legal_name    = excluded.legal_name,
         tax_id        = excluded.tax_id,
         contact_email = excluded.contact_email,
         contact_phone = excluded.contact_phone,
         proof_url     = coalesce(excluded.proof_url, business_accounts.proof_url),
         status        = excluded.status,
         auto_approved = excluded.auto_approved,
         reject_reason = null,
         reviewed_at   = excluded.reviewed_at,
         reviewed_by   = excluded.reviewed_by,
         updated_at    = now()
       returning id`,
      [
        input.userId,
        slug,
        venue.place_name,
        venue.city,
        input.legalName,
        taxId || null,
        input.contactEmail,
        input.contactPhone ? String(input.contactPhone).trim() : null,
        input.proofUrl ?? null,
        auto ? 'verified' : 'pending',
        auto,
        auto ? new Date() : null,
        auto ? 'auto:tax_id' : null,
      ]
    );
    return res.rows[0]!;
  });

  const business = await loadMineById(saved.id, input.userId);
  return { business: business!, autoApproved: auto };
}

/** Моите бизнес профили (един човек може да представлява няколко обекта). */
export async function loadMyBusinesses(userId: string): Promise<BusinessMine[]> {
  const rows = await many<Row & { replies_count: string }>(
    `select b.*,
            (select count(*)::text from business_replies br where br.business_id = b.id) as replies_count
       from business_accounts b
      where b.owner_user_id = $1
      order by b.created_at desc`,
    [userId]
  );
  return rows.map((r) => ({
    ...toPublic(r),
    status: r.status,
    tax_id: r.tax_id,
    contact_email: r.contact_email,
    contact_phone: r.contact_phone,
    auto_approved: r.auto_approved,
    reject_reason: r.reject_reason,
    created_at: iso(r.created_at)!,
    reviewed_at: iso(r.reviewed_at),
    replies_count: Number(r.replies_count ?? 0),
  }));
}

async function loadMineById(id: string, userId: string): Promise<BusinessMine | null> {
  const row = await one<Row & { replies_count: string }>(
    `select b.*,
            (select count(*)::text from business_replies br where br.business_id = b.id) as replies_count
       from business_accounts b
      where b.id = $1 and b.owner_user_id = $2`,
    [id, userId]
  );
  if (!row) return null;
  return {
    ...toPublic(row),
    status: row.status,
    tax_id: row.tax_id,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    auto_approved: row.auto_approved,
    reject_reason: row.reject_reason,
    created_at: iso(row.created_at)!,
    reviewed_at: iso(row.reviewed_at),
    replies_count: Number(row.replies_count ?? 0),
  };
}

/** Публичната информация за обект (за значката ✅ Проверен търговец). */
export async function businessForVenue(slug: string): Promise<BusinessPublic | null> {
  const row = await one<Row>(
    `select * from business_accounts where venue_slug = $1 and status = 'verified' limit 1`,
    [slug]
  );
  return row ? toPublic(row) : null;
}

/** Проверените търговци за списък от слугове (една заявка, не N). */
export async function verifiedBusinessesForVenues(
  slugs: string[]
): Promise<Record<string, BusinessPublic>> {
  const list = [...new Set(slugs.filter((s) => /^[0-9a-f]{32}$/.test(s)))];
  if (list.length === 0) return {};
  const rows = await many<Row>(
    `select * from business_accounts where status = 'verified' and venue_slug = any($1::text[])`,
    [list]
  );
  const out: Record<string, BusinessPublic> = {};
  for (const r of rows) out[r.venue_slug] = toPublic(r);
  return out;
}

/** Търговецът, който отговаря за обекта на даден пост (за екрана на офертата). */
export async function businessForPost(postId: string): Promise<BusinessPublic | null> {
  const row = await one<Row>(
    `select b.*
       from business_accounts b
       join posts p on p.id = $1
      where b.status = 'verified'
        and b.venue_slug = md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city)))
      limit 1`,
    [postId]
  );
  return row ? toPublic(row) : null;
}

export interface BusinessReply {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  business_id: string;
  legal_name: string;
  place_name: string;
  city: string | null;
}

export async function repliesForPost(postId: string): Promise<BusinessReply[]> {
  return many<BusinessReply>(
    `select br.id, br.post_id::text, br.body, br.created_at::text,
            b.id::text as business_id, b.legal_name, b.place_name, b.city
       from business_replies br
       join business_accounts b on b.id = br.business_id
      where br.post_id = $1 and b.status = 'verified'
      order by br.created_at desc`,
    [postId]
  );
}

/** Официалните отговори за много постове наведнъж (лентата ги показва). */
export async function repliesForPosts(
  postIds: string[]
): Promise<Record<string, BusinessReply[]>> {
  const list = [
    ...new Set(postIds.map((p) => String(p).trim()).filter((p) => UUID_RE.test(p))),
  ];
  if (list.length === 0) return {};
  const rows = await many<BusinessReply>(
    `select br.id, br.post_id::text, br.body, br.created_at::text,
            b.id::text as business_id, b.legal_name, b.place_name, b.city
       from business_replies br
       join business_accounts b on b.id = br.business_id
      where br.post_id = any($1::uuid[]) and b.status = 'verified'
      order by br.created_at desc`,
    [list]
  );
  const out: Record<string, BusinessReply[]> = {};
  for (const r of rows) (out[r.post_id] ??= []).push(r);
  return out;
}

/** Пише официален отговор под сигнал за СВОЯ обект. */
export async function addBusinessReply(params: {
  userId: string;
  businessId: string;
  postId: string;
  body: string;
}): Promise<BusinessReply> {
  const row = await one<Row>(
    `select * from business_accounts where id = $1 and owner_user_id = $2`,
    [params.businessId, params.userId]
  );
  if (!row) throw notFound('Бизнес профилът не е намерен.');
  if (row.status !== 'verified') {
    throw badRequest('Още не си проверен търговец — отговорът ще е възможен след одобрение.');
  }

  const owns = await one<{ ok: number }>(
    `select 1 as ok from posts
      where id = $1 and status = 'published'
        and md5(lower(btrim(place_name)) || '|' || lower(btrim(city))) = $2`,
    [params.postId, row.venue_slug]
  );
  if (!owns) throw badRequest('Този сигнал не е за твоя обект.');

  /**
   * 💰 Гейтът на плана.
   *
   * Безплатно: 1 официален отговор на месец — достатъчно търговецът да види,
   * че работи и че хората го четат. Платено: неограничено. Съобщението казва
   * точно какво да направи, вместо да отказва сухо.
   */
  if (!hasActivePlan(row)) {
    const used = await repliesLast30Days(row.id);
    if (used >= FREE_REPLIES_PER_MONTH) {
      throw forbidden(
        `Безплатният план включва ${FREE_REPLIES_PER_MONTH} официален отговор на месец ` +
          `(използван). С план „Проверен търговец“ (${PLAN_PRICE_EUR} €/мес) отговаряш ` +
          'неограничено, пускаш оферти и виждаш статистиката на обекта.'
      );
    }
  }

  const body = params.body.trim();
  if (body.length < 20) throw badRequest('Отговорът е твърде кратък (поне 20 знака).');
  if (body.length > 1500) throw badRequest('Отговорът е твърде дълъг (до 1500 знака).');

  const existing = await one<{ id: string }>(
    `select id from business_replies where business_id = $1 and post_id = $2`,
    [row.id, params.postId]
  );
  if (existing) throw conflict('Вече си отговорил официално на този сигнал.');

  const saved = await one<{ id: string }>(
    `insert into business_replies (business_id, post_id, body)
     values ($1,$2,$3) returning id`,
    [row.id, params.postId, body]
  );

  const reply = await one<BusinessReply>(
    `select br.id, br.post_id::text, br.body, br.created_at::text,
            b.id::text as business_id, b.legal_name, b.place_name, b.city
       from business_replies br
       join business_accounts b on b.id = br.business_id
      where br.id = $1`,
    [saved!.id]
  );
  return reply!;
}

/** Колко отговора е пуснал търговецът (за таблото и за бъдещите лимити). */
export async function businessReplyCount(businessId: string): Promise<number> {
  const row = await one<{ n: string }>(
    `select count(*)::text as n from business_replies where business_id = $1`,
    [businessId]
  );
  return Number(row?.n ?? 0);
}

/** Отговорите през последните 30 дни — това брои безплатният план. */
export async function repliesLast30Days(businessId: string): Promise<number> {
  const row = await one<{ n: string }>(
    `select count(*)::text as n from business_replies
      where business_id = $1 and created_at > now() - interval '30 days'`,
    [businessId]
  );
  return Number(row?.n ?? 0);
}

/* ======================= 💰 Плащания за абонамента ======================= */

export interface StartPaymentInput {
  businessId: string;
  userId: string;
  sessionId: string;
  months: number;
  amount: number;
}

export async function startBusinessPayment(input: StartPaymentInput): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into business_payments
       (business_id, user_id, amount, months, stripe_checkout_session_id, status)
     values ($1,$2,$3,$4,$5,'pending') returning id`,
    [input.businessId, input.userId, input.amount, input.months, input.sessionId]
  );
  return row!.id;
}

/**
 * Плащането е минало → удължаваме абонамента.
 *
 * ВАЖНО: удължаваме от `paid_until`, ако още не е изтекъл (иначе човек, който
 * плати 5 дни преди края, губи тези 5 дни). Записът е идемпотентен по
 * `stripe_event_id` — Stripe може да прати същото събитие повече от веднъж.
 */
export async function applyBusinessPayment(params: {
  sessionId: string;
  subscriptionId?: string | null;
  eventId: string;
}): Promise<{ businessId: string; months: number; paidUntil: string | null } | null> {
  return tx(async (client) => {
    const pay = await client.query<{
      id: string;
      business_id: string;
      months: number;
      status: string;
    }>(
      `select id, business_id, months, status from business_payments
        where stripe_checkout_session_id = $1 for update`,
      [params.sessionId]
    );
    const row = pay.rows[0];
    if (!row) return null; // не е бизнес плащане (напр. дарение) — не пипаме нищо
    if (row.status === 'succeeded') {
      const b = await client.query<{ paid_until: Date | null }>(
        `select paid_until from business_accounts where id = $1`,
        [row.business_id]
      );
      return { businessId: row.business_id, months: row.months, paidUntil: iso(b.rows[0]?.paid_until ?? null) };
    }

    await client.query(
      `update business_payments
          set status = 'succeeded', paid_at = now(), stripe_event_id = $2,
              stripe_subscription_id = coalesce($3, stripe_subscription_id)
        where id = $1`,
      [row.id, params.eventId, params.subscriptionId ?? null]
    );

    const updated = await client.query<{ paid_until: Date }>(
      `update business_accounts
          set tier = 'verified',
              paid_until = greatest(coalesce(paid_until, now()), now()) + ($2 || ' month')::interval,
              updated_at = now()
        where id = $1
        returning paid_until`,
      [row.business_id, String(row.months)]
    );

    return {
      businessId: row.business_id,
      months: row.months,
      paidUntil: iso(updated.rows[0]?.paid_until ?? null),
    };
  });
}

/** Абонамент, който се подновява всеки месец (Stripe `invoice.paid`). */
export async function renewBusinessSubscription(params: {
  subscriptionId: string;
  eventId: string;
}): Promise<{ businessId: string; paidUntil: string | null } | null> {
  return tx(async (client) => {
    const pay = await client.query<{ business_id: string }>(
      `select business_id from business_payments
        where stripe_subscription_id = $1 and status = 'succeeded'
        order by created_at desc limit 1`,
      [params.subscriptionId]
    );
    const businessId = pay.rows[0]?.business_id;
    if (!businessId) return null;

    const updated = await client.query<{ paid_until: Date }>(
      `update business_accounts
          set tier = 'verified',
              paid_until = greatest(coalesce(paid_until, now()), now()) + interval '1 month',
              updated_at = now()
        where id = $1
        returning paid_until`,
      [businessId]
    );
    // Пишем и ред в плащанията, за да се вижда историята на подновяванията.
    await client.query(
      `insert into business_payments (business_id, user_id, amount, months, status, paid_at,
                                      stripe_subscription_id, stripe_event_id, currency)
       select b.id, b.owner_user_id, $2, 1, 'succeeded', now(), $1, $3, 'EUR'
         from business_accounts b where b.id = $4`,
      [params.subscriptionId, PLAN_PRICE_EUR, params.eventId, businessId]
    );
    return { businessId, paidUntil: iso(updated.rows[0]?.paid_until ?? null) };
  });
}

export async function failBusinessPayment(params: {
  sessionId?: string | null;
  eventId: string;
}): Promise<void> {
  if (!params.sessionId) return;
  await one(
    `update business_payments set status = 'failed', stripe_event_id = $2
      where stripe_checkout_session_id = $1 and status = 'pending' returning id`,
    [params.sessionId, params.eventId]
  );
}

/** Проверка след връщане от Stripe (ако webhook-ът още не е пристигнал). */
export async function businessPaymentBySession(
  sessionId: string
): Promise<{ id: string; business_id: string; user_id: string; status: string; months: number } | null> {
  return one(
    `select id, business_id, user_id, status, months from business_payments
      where stripe_checkout_session_id = $1`,
    [sessionId]
  );
}

/** История на плащанията на един бизнес (за таблото). */
export async function businessPayments(
  businessId: string
): Promise<Array<{ id: string; amount: number; currency: string; months: number; status: string; created_at: string; paid_at: string | null }>> {
  return many(
    `select id, amount::float, currency, months, status, created_at::text, paid_at::text
       from business_payments where business_id = $1
      order by created_at desc limit 24`,
    [businessId]
  );
}

/* ========================= 🏷️ Оферти от търговеца =========================
 * ВАЖНО (продуктово решение): офертите НЕ влизат в общата лента с находки.
 * Лентата е честна цена от хора; ако в нея влязат платени промоции, доверието
 * (което е целият смисъл на SmartPrice) пада. Затова офертата се вижда в
 * НЕГОВИЯ обект и на екрана на негова оферта — там човекът вече е при него.
 */

export interface BusinessOffer {
  id: string;
  business_id: string;
  title: string;
  description: string;
  price: number | null;
  old_price: number | null;
  image_url: string | null;
  valid_until: string | null;
  status: 'active' | 'hidden';
  created_at: string;
  /** Изтекла ли е вече (по `valid_until`). */
  expired: boolean;
}

interface OfferRow {
  id: string;
  business_id: string;
  title: string;
  description: string;
  price: number | null;
  old_price: number | null;
  image_url: string | null;
  valid_until: Date | string | null;
  status: 'active' | 'hidden';
  created_at: Date | string;
}

/**
 * Колоната `valid_until` е тип `date`, а pg я връща като JS Date → `String(date)`
 * дава „Sun Nov 15 2026…“ и отрязаното до 10 знака става „Sun Nov 15“ (грешка,
 * която потребителят виждаше в приложението). Затова форматираме ИЗРИЧНО.
 */
const dayOnly = (v: Date | string | null): string | null => {
  if (v == null) return null;
  if (v instanceof Date) {
    // Дата без час: ползваме UTC частите, за да не измести деня часовата зона.
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const mapOffer = (r: OfferRow): BusinessOffer => {
  const validUntil = dayOnly(r.valid_until);
  return {
    id: r.id,
    business_id: r.business_id,
    title: r.title,
    description: r.description,
    price: r.price == null ? null : Number(r.price),
    old_price: r.old_price == null ? null : Number(r.old_price),
    image_url: r.image_url,
    valid_until: validUntil,
    status: r.status,
    created_at: iso(r.created_at)!,
    expired: Boolean(validUntil && validUntil < new Date().toISOString().slice(0, 10)),
  };
};

/** Офертите на търговеца (за таблото — включително скритите). */
export async function listBusinessOffers(businessId: string): Promise<BusinessOffer[]> {
  const rows = await many<OfferRow>(
    `select * from business_offers where business_id = $1 order by created_at desc limit 50`,
    [businessId]
  );
  return rows.map(mapOffer);
}

/** Публичните оферти на един обект (само активни и не изтекли). */
export async function publicOffersForVenue(slug: string, limit = 5): Promise<BusinessOffer[]> {
  const rows = await many<OfferRow>(
    `select o.* from business_offers o
       join business_accounts b on b.id = o.business_id
      where b.venue_slug = $1 and b.status = 'verified'
        and o.status = 'active'
        and (o.valid_until is null or o.valid_until >= current_date)
      order by o.created_at desc limit $2`,
    [slug, limit]
  );
  return rows.map(mapOffer);
}

export interface OfferInput {
  userId: string;
  businessId: string;
  title: string;
  description?: string;
  price?: number | null;
  oldPrice?: number | null;
  imageUrl?: string | null;
  validUntil?: string | null;
}

/** Пуска оферта. Иска проверен търговец И активен абонамент (това е платеното). */
export async function createBusinessOffer(input: OfferInput): Promise<BusinessOffer> {
  const row = await one<Row>(
    `select * from business_accounts where id = $1 and owner_user_id = $2`,
    [input.businessId, input.userId]
  );
  if (!row) throw notFound('Бизнес профилът не е намерен.');
  if (row.status !== 'verified') {
    throw badRequest('Още не си проверен търговец — оферти може след одобрение.');
  }
  if (!hasActivePlan(row)) {
    throw forbidden(
      `Офертите са част от плана „Проверен търговец“ (${PLAN_PRICE_EUR} €/мес). ` +
        'Активирай го от таблото и веднага можеш да пуснеш промоция.'
    );
  }

  const title = input.title.trim();
  if (title.length < 3) throw badRequest('Заглавието е твърде кратко.');
  const description = (input.description ?? '').trim();
  if (description.length > 1000) throw badRequest('Описанието е твърде дълго (до 1000 знака).');

  const price = input.price == null ? null : Number(input.price);
  const oldPrice = input.oldPrice == null ? null : Number(input.oldPrice);
  if (price != null && (!Number.isFinite(price) || price <= 0)) throw badRequest('Цената трябва да е положителна.');
  if (oldPrice != null && (!Number.isFinite(oldPrice) || oldPrice <= 0)) throw badRequest('Старата цена трябва да е положителна.');
  if (price != null && oldPrice != null && oldPrice <= price) {
    throw badRequest('Старата цена трябва да е по-висока от новата — иначе не е отстъпка.');
  }
  if (oldPrice != null && price == null) throw badRequest('Ако даваш стара цена, дай и новата.');

  const saved = await one<OfferRow>(
    `insert into business_offers (business_id, title, description, price, old_price, image_url, valid_until)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [row.id, title, description, price, oldPrice, input.imageUrl ?? null, input.validUntil || null]
  );
  return mapOffer(saved!);
}

export async function setBusinessOfferStatus(params: {
  userId: string;
  offerId: string;
  status: 'active' | 'hidden';
}): Promise<void> {
  const res = await one<{ id: string }>(
    `update business_offers o set status = $3, updated_at = now()
       from business_accounts b
      where o.business_id = b.id and o.id = $1 and b.owner_user_id = $2
      returning o.id`,
    [params.offerId, params.userId, params.status]
  );
  if (!res) throw notFound('Офертата не е намерена.');
}

export async function deleteBusinessOffer(params: {
  userId: string;
  offerId: string;
}): Promise<void> {
  const res = await one<{ id: string }>(
    `delete from business_offers o
       using business_accounts b
      where o.business_id = b.id and o.id = $1 and b.owner_user_id = $2
      returning o.id`,
    [params.offerId, params.userId]
  );
  if (!res) throw notFound('Офертата не е намерена.');
}

/* ======================= 📊 Статистика на обекта ======================= */

/**
 * Брои едно отваряне на страницата на обекта.
 *
 * Защо по (слуг, ден): търговецът иска да види „колко души ме гледат“ — това е
 * най-силният аргумент да плаща. Пазим само сбор по дни, никакви лични данни.
 */
export async function registerVenueView(slug: string): Promise<void> {
  if (!/^[0-9a-f]{32}$/.test(slug)) return;
  await one(
    `insert into venue_views (venue_slug, day, views) values ($1, current_date, 1)
     on conflict (venue_slug, day) do update set views = venue_views.views + 1
     returning venue_slug`,
    [slug]
  );
}

export interface VenueStats {
  views_today: number;
  views_7d: number;
  views_30d: number;
  signals_count: number;
  replies_count: number;
  reports_30d: number;
  avg_rating: number | null;
  plan_active: boolean;
  paid_until: string | null;
}

/** Статистиката за таблото на търговеца. */
export async function venueStats(businessId: string): Promise<VenueStats | null> {
  const row = await one<Row>(
    `select * from business_accounts where id = $1`,
    [businessId]
  );
  if (!row) return null;

  const [views, extra] = await Promise.all([
    one<{ today: string; d7: string; d30: string }>(
      `select
         coalesce(sum(views) filter (where day = current_date), 0)::text as today,
         coalesce(sum(views) filter (where day > current_date - 7), 0)::text as d7,
         coalesce(sum(views) filter (where day > current_date - 30), 0)::text as d30
       from venue_views where venue_slug = $1`,
      [row.venue_slug]
    ),
    one<{ signals: string; replies: string; recent: string; rating: number | null }>(
      `select
         (select count(*)::text from posts p
           where p.status = 'published'
             and md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) = $1) as signals,
         (select count(*)::text from business_replies br where br.business_id = $2) as replies,
         (select count(*)::text from posts p
           where p.status = 'published' and p.created_at > now() - interval '30 days'
             and md5(lower(btrim(p.place_name)) || '|' || lower(btrim(p.city))) = $1) as recent,
         (select rating::float from place_enrichment where slug = $1) as rating`,
      [row.venue_slug, row.id]
    ),
  ]);

  return {
    views_today: Number(views?.today ?? 0),
    views_7d: Number(views?.d7 ?? 0),
    views_30d: Number(views?.d30 ?? 0),
    signals_count: Number(extra?.signals ?? 0),
    replies_count: Number(extra?.replies ?? 0),
    reports_30d: Number(extra?.recent ?? 0),
    avg_rating: extra?.rating ?? null,
    plan_active: hasActivePlan(row),
    paid_until: iso(row.paid_until),
  };
}
