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
import { badRequest, conflict, notFound } from './errors.js';

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
    // Когато дойдат плановете, тук ще се иска и активен абонамент.
    can_reply: row.status === 'verified',
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
  const list = [...new Set(postIds.map((p) => String(p)).filter((p) => /^\d+$/.test(p)))];
  if (list.length === 0) return {};
  const rows = await many<BusinessReply>(
    `select br.id, br.post_id::text, br.body, br.created_at::text,
            b.id::text as business_id, b.legal_name, b.place_name, b.city
       from business_replies br
       join business_accounts b on b.id = br.business_id
      where br.post_id = any($1::bigint[]) and b.status = 'verified'
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
