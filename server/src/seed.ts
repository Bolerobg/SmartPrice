import { one, tx } from './db.js';
import { hashPassword } from './lib/auth.js';

/**
 * Начални данни.
 *
 * ВАЖНО (промяна спрямо старата версия): демонстрационните записи вече НЕ
 * обвиняват реални български обекти. Имената са измислени, всеки запис е
 * маркиран с таг #Демо, а бележките НЕ са отбелязани като „AI верифицирани“ —
 * защото не са. Така демото показва дизайна, без да създава правен риск.
 */

const BADGES = [
  {
    id: 'badge-first-post',
    title: 'Първи сигнал',
    icon: 'megaphone',
    description: 'Публикува първата си цена',
    color: '#06B6D4',
    sort: 10,
    metric: 'posts',
    threshold: 1,
  },
  {
    id: 'badge-receipt-master',
    title: 'Детектив с Бележка',
    icon: 'receipt',
    description: 'Качени 5 касови бележки',
    color: '#10B981',
    sort: 20,
    metric: 'receipts',
    threshold: 5,
  },
  {
    id: 'badge-red-hunter',
    title: 'Разобличител на Капани',
    icon: 'warning',
    description: 'Публикувал 5 червени флага срещу спекулативни цени',
    color: '#F43F5E',
    sort: 30,
    metric: 'red_flags',
    threshold: 5,
  },
  {
    id: 'badge-saver-1k',
    title: 'Спестител 500+ €',
    icon: 'trophy',
    description: 'Твоите постове са спестили над 500 € на другите',
    color: '#8B5CF6',
    sort: 40,
    metric: 'savings',
    threshold: 500,
  },
  {
    id: 'badge-supporter',
    title: 'Пазител на Общността',
    icon: 'shield-checkmark',
    description: 'Подкрепи независимостта на SmartPrice с дарение',
    color: '#F59E0B',
    sort: 50,
    metric: 'supporter',
    threshold: 1,
  },

  // ---- Стълбичката за проверки на цени (новата функция) ----
  { id: 'badge-check-1',    title: 'Първи поглед',        icon: 'eye',        description: 'Провери първата си чужда цена на място', color: '#06B6D4', sort: 100, metric: 'price_checks',      threshold: 1 },
  { id: 'badge-check-5',    title: 'Проверяващ',          icon: 'search',     description: 'Провери 5 чужди цени на място',          color: '#22D3EE', sort: 101, metric: 'price_checks',      threshold: 5 },
  { id: 'badge-check-25',   title: 'Детектив на цени',    icon: 'binoculars', description: 'Провери 25 чужди цени на място',         color: '#8B5CF6', sort: 102, metric: 'price_checks',      threshold: 25 },
  { id: 'badge-check-100',  title: 'Пазител на цените',   icon: 'shield',     description: 'Провери 100 чужди цени на място',        color: '#F59E0B', sort: 103, metric: 'price_checks',      threshold: 100 },
  { id: 'badge-correct-1',  title: 'Поправи цена',        icon: 'create',     description: 'Поправи първата сгрешена цена',          color: '#FBBF24', sort: 110, metric: 'price_corrections', threshold: 1 },
  { id: 'badge-correct-10', title: 'Коректор',            icon: 'build',      description: 'Поправи 10 сгрешени цени',               color: '#EF4444', sort: 111, metric: 'price_corrections', threshold: 10 },
  { id: 'badge-points-100', title: 'Доверен',             icon: 'star',       description: 'Събра 100 точки доверие',                color: '#FBBF24', sort: 120, metric: 'reputation_points', threshold: 100 },
  { id: 'badge-points-500', title: 'Стожер на общността', icon: 'ribbon',     description: 'Събра 500 точки доверие',                color: '#F59E0B', sort: 121, metric: 'reputation_points', threshold: 500 },
];

const DEMO_USERS = [
  { email: 'demo.viki@smartprice.local', name: 'Виктория Стоянова', handle: '@viki_demo', city: 'София' },
  { email: 'demo.marto@smartprice.local', name: 'Мартин Георгиев', handle: '@marto_demo', city: 'Пловдив' },
  { email: 'demo.desi@smartprice.local', name: 'Десислава Колева', handle: '@desi_demo', city: 'Варна' },
];

interface DemoPost {
  authorIndex: number;
  polarity: 'green' | 'red';
  category: string;
  platformTag: string;
  title: string;
  description: string;
  placeName: string;
  city: string;
  address: string;
  pricePaid: number;
  referencePrice?: number;
  isShrinkflation?: boolean;
  imageUrl: string;
  receipt?: {
    merchantName: string;
    merchantTaxId: string;
    date: string;
    time: string;
    totalAmount: number;
    items: Array<{ name: string; quantity: number; unitPrice: number; highlightReason?: string }>;
  };
}

const DEMO_POSTS: DemoPost[] = [
  {
    authorIndex: 0,
    polarity: 'red',
    category: 'restaurants',
    platformTag: 'На място',
    title: 'Демо: 3.53 € за 330 мл вода и „такса куверт“ в менюто с дребен шрифт',
    description:
      'Демонстрационен запис, който показва как изглежда червен флаг. Заведението е измислено („Крайбрежен Бриз“) — имената и бележката са примерни.',
    placeName: 'Заведение „Крайбрежен Бриз“ (демо)',
    city: 'Созопол',
    address: 'Крайбрежна алея 14',
    pricePaid: 34.97,
    referencePrice: 21.47,
    imageUrl:
      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=900&auto=format&fit=crop&q=80',
    receipt: {
      merchantName: 'КРАЙБРЕЖЕН БРИЗ (ДЕМО)',
      merchantTaxId: '000000000',
      date: '10.10.2026',
      time: '20:42',
      totalAmount: 34.97,
      items: [
        { name: 'Салата асорти', quantity: 2, unitPrice: 6.39 },
        { name: 'Минерална вода 330 мл', quantity: 2, unitPrice: 3.53, highlightReason: '🚨 3.53 € за 330 мл вода' },
        { name: 'Такса обслужване', quantity: 1, unitPrice: 8.74, highlightReason: '🚨 Необявена в менюто такса' },
      ],
    },
  },
  {
    authorIndex: 1,
    polarity: 'green',
    category: 'supermarket',
    platformTag: 'Супермаркет',
    title: 'Демо: Овче сирене 1 кг за 8.13 € на фермерски щанд',
    description:
      'Демонстрационен запис за зелена находка. Цената и мястото са примерни и служат само за показване на дизайна.',
    placeName: 'Фермерски щанд „Родопи“ (демо)',
    city: 'Пловдив',
    address: 'ул. „Княз Александър I“ 32',
    pricePaid: 8.13,
    referencePrice: 11.5,
    imageUrl:
      'https://images.unsplash.com/photo-1542838132-92c53300491e?w=900&auto=format&fit=crop&q=80',
    receipt: {
      merchantName: 'РОДОПИ ФЕРМЕР (ДЕМО)',
      merchantTaxId: '000000001',
      date: '09.10.2026',
      time: '11:15',
      totalAmount: 8.13,
      items: [{ name: 'Овче сирене 1 кг', quantity: 1, unitPrice: 8.13, highlightReason: '🔥 Под обичайната цена' }],
    },
  },
  {
    authorIndex: 2,
    polarity: 'red',
    category: 'supermarket',
    platformTag: 'Супермаркет',
    title: 'Демо: шринкфлация — 380 г вместо 500 г, а цената същата',
    description:
      'Демонстрационен запис за шринкфлация. Продуктът е примерен.',
    placeName: 'Хипермаркет „Пример“ (демо)',
    city: 'Варна',
    address: 'бул. „Княз Борис I“ 65',
    pricePaid: 4.85,
    referencePrice: 4.85,
    isShrinkflation: true,
    imageUrl:
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=900&auto=format&fit=crop&q=80',
  },
  {
    authorIndex: 0,
    polarity: 'green',
    category: 'cafes_bars',
    platformTag: 'На място',
    title: 'Демо: 2 кафета + кроасан за 5.01 €',
    description: 'Демонстрационен запис за добра оферта в кафене. Примерни данни.',
    placeName: 'Кафене „Тиха улица“ (демо)',
    city: 'София',
    address: 'бул. „Витоша“ 89',
    pricePaid: 5.01,
    referencePrice: 7.16,
    imageUrl:
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=900&auto=format&fit=crop&q=80',
  },
  {
    authorIndex: 1,
    polarity: 'red',
    category: 'hotels_airbnb',
    platformTag: 'Booking.com',
    title: 'Демо: „безплатен паркинг“ в обявата, 15.34 € на място',
    description: 'Демонстрационен запис за разминаване между обява и реалност. Примерни данни.',
    placeName: 'Хотел „Панорама“ (демо)',
    city: 'Банско',
    address: 'ул. „Пирин“ 92',
    pricePaid: 107.37,
    referencePrice: 76.69,
    imageUrl:
      'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=900&auto=format&fit=crop&q=80',
  },
  {
    authorIndex: 2,
    polarity: 'green',
    category: 'services_tech',
    platformTag: 'На място',
    title: 'Демо: диагностика на климатик за 12.78 € без скрити такси',
    description: 'Демонстрационен запис за коректна услуга. Примерни данни.',
    placeName: 'Сервиз „Хладен въздух“ (демо)',
    city: 'Стара Загора',
    address: 'бул. „Цар Симеон Велики“ 105',
    pricePaid: 12.78,
    referencePrice: 23.01,
    imageUrl:
      'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=900&auto=format&fit=crop&q=80',
  },
];

async function seedBadges() {
  for (const b of BADGES) {
    await one(
      `insert into badges (id, title, icon, description, color, sort_order, metric, threshold)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update
         set title = excluded.title, icon = excluded.icon,
             description = excluded.description, color = excluded.color,
             sort_order = excluded.sort_order,
             metric = excluded.metric, threshold = excluded.threshold
       returning id`,
      [b.id, b.title, b.icon, b.description, b.color, b.sort, b.metric, b.threshold]
    );
  }
}

export async function seedDemoData(): Promise<void> {
  await seedBadges();

  const existing = await one<{ count: number }>('select count(*) as count from posts');
  if ((existing?.count ?? 0) > 0) return;

  // Демо профилите получават случайна парола (никой не може да влезе с тях)
  const randomPassword = `${Math.random().toString(36).slice(2)}Aa1!${Date.now()}`;
  const passwordHash = await hashPassword(randomPassword);

  await tx(async (client) => {
    const authorIds: string[] = [];

    for (const u of DEMO_USERS) {
      const res = await client.query<{ id: string }>(
        `insert into profiles (email, password_hash, name, handle, city, bio, reputation_points)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (email) do update set name = excluded.name
         returning id`,
        [
          u.email,
          passwordHash,
          u.name,
          u.handle,
          u.city,
          'Демонстрационен профил — примерни данни за показване на дизайна.',
          120,
        ]
      );
      const id = res.rows[0]!.id;
      authorIds.push(id);
      await client.query(
        `insert into profile_badges (profile_id, badge_id)
         select $1, id from badges on conflict do nothing`,
        [id]
      );
      // Значките се отключват сами според реалната активност (виж
      // lib/badges.ts → syncBadges). Тук не маркираме нищо на ръка — иначе
      // демо профил може да показва „отключена“ значка, която не е заслужил.

    }

    for (const p of DEMO_POSTS) {
      const authorId = authorIds[p.authorIndex]!;
      const unitType = 'g';
      const unitQuantity = p.category === 'supermarket' ? 1000 : undefined;

      const postRes = await client.query<{ id: string }>(
        `insert into posts (
           author_id, polarity, category, platform_tag, title, description,
           place_name, city, address, price_paid, reference_price, currency,
           unit_quantity, unit_type, price_per_unit, is_shrinkflation, image_url, tags
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'EUR',$12,$13,$14,$15,$16,$17)
         returning id`,
        [
          authorId,
          p.polarity,
          p.category,
          p.platformTag,
          p.title,
          p.description,
          p.placeName,
          p.city,
          p.address,
          p.pricePaid,
          p.referencePrice ?? null,
          unitQuantity ?? null,
          unitQuantity ? unitType : null,
          unitQuantity ? Number(((p.pricePaid / unitQuantity) * 1000).toFixed(4)) : null,
          p.isShrinkflation ?? false,
          p.imageUrl,
          [
            '#Демо',
            p.polarity === 'green' ? '#ТопНаходка' : '#ЧервенФлаг',
            `#${p.city.replace(/\s+/g, '')}`,
          ],
        ]
      );
      const postId = postRes.rows[0]!.id;

      if (p.receipt) {
        const receiptRes = await client.query<{ id: string }>(
          `insert into receipts (post_id, merchant_name, merchant_tax_id, receipt_date,
                                 receipt_time, total_amount, currency, confidence,
                                 verified_by_ai, source)
           values ($1,$2,$3,$4,$5,$6,'EUR',0,false,'manual') returning id`,
          [
            postId,
            p.receipt.merchantName,
            p.receipt.merchantTaxId,
            p.receipt.date,
            p.receipt.time,
            p.receipt.totalAmount,
          ]
        );
        const receiptId = receiptRes.rows[0]!.id;

        for (const [index, item] of p.receipt.items.entries()) {
          await client.query(
            `insert into receipt_items (receipt_id, position, name, quantity, unit_price,
                                        total_price, highlight_reason)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [
              receiptId,
              index,
              item.name,
              item.quantity,
              item.unitPrice,
              Number((item.quantity * item.unitPrice).toFixed(2)),
              item.highlightReason ?? null,
            ]
          );
        }
      }
    }

    // Малко реалистична активност: реакции и отметки между демо профилите
    const posts = await client.query<{ id: string; polarity: string }>(
      'select id, polarity from posts order by created_at'
    );
    const greenKeys = ['topDeal', 'worthIt', 'doubt'];
    const redKeys = ['pureRobbery', 'avoid', 'exaggerated'];

    for (const post of posts.rows) {
      const keys = post.polarity === 'green' ? greenKeys : redKeys;
      for (const [userIndex, authorId] of authorIds.entries()) {
        await client.query(
          `insert into post_reactions (post_id, user_id, reaction_key)
           values ($1,$2,$3) on conflict do nothing`,
          [post.id, authorId, keys[userIndex % keys.length]!]
        );
      }
    }
  });

  console.log(`[seed] добавени ${DEMO_POSTS.length} демо публикации (маркирани с #Демо)`);
}
