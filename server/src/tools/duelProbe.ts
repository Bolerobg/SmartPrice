/**
 * Сонда (само за проверка на живо): ⚔️ ценова проверка върху реални данни.
 *
 * Пуска се ВЪТРЕ в контейнера, върху истинската база:
 *   docker cp duelbuild/. smartprice-api:/app/dist/ && docker exec smartprice-api node /app/dist/tools/duelProbe.js
 *
 * Показва: колко оферти на страницата имат конкурент, каква е присъдата, и
 * пълния дуел за първата оферта с конкуренция (за да се види с очите си, че
 * сравнението е смислено, а не „всичко съвпада с всичко“).
 */
import { many, closePool } from '../db.js';
import { compareForPosts, priceDuel, productTokens } from '../lib/priceDuel.js';

async function main() {
  // С конкретен id: проверяваме само него (за да хващаме фалшивите конкурент.
  const only = process.argv[2];
  if (only) {
    const duel = await priceDuel(only);
    console.log(`\n=== Дуел за ${only} ===`);
    if (!duel) {
      console.log('  (няма конкурент — правилно, ако продуктът е уникален)');
    } else {
      console.log(
        `моята цена ${duel.myPrice.toFixed(2)} € · присъда ${duel.verdict} · min ${duel.minPrice.toFixed(2)} · avg ${duel.avgPrice.toFixed(2)}`
      );
      for (const o of duel.others) {
        console.log(
          `  ${o.cheaper ? '🟢' : '🚩'} ${o.price.toFixed(2)} € — "${o.title}" · ${o.place ?? ''} · сходство ${o.similarity}`
        );
      }
    }
    return;
  }

  const ids = await many<{ id: string }>(
    `select id from posts where status = 'published' and price_paid > 0
      order by created_at desc limit 40`
  );
  const list = ids.map((r) => r.id);

  const map = await compareForPosts(list);
  console.log(`\n=== Кратката проверка (лентата) ===`);
  console.log(`оферти в страницата: ${list.length}, с конкурент: ${map.size}`);

  let i = 0;
  for (const [id, c] of map) {
    if (i >= 6) break;
    console.log(
      `  • ${id.slice(0, 8)} → ${c.twinCount} конкурента, най-ниска ${c.cheapestPrice.toFixed(2)} €` +
        (c.cheapestPlace ? ` (${c.cheapestPlace})` : '') +
        `, присъда ${c.verdict}, +${c.saving.toFixed(2)} € / ${c.savingPct}%`
    );
    i += 1;
  }

  const first = Array.from(map.keys())[0];
  if (first) {
    const duel = await priceDuel(first);
    console.log(`\n=== Пълният дуел за оферта ${first.slice(0, 8)} ===`);
    if (!duel) {
      console.log('  (няма дуел)');
    } else {
      console.log(
        `моята цена ${duel.myPrice.toFixed(2)} € · присъда ${duel.verdict} · min ${duel.minPrice.toFixed(2)} · avg ${duel.avgPrice.toFixed(2)} · max ${duel.maxPrice.toFixed(2)} · над средното ${duel.overAvgPct}%`
      );
      for (const o of duel.others.slice(0, 8)) {
        console.log(
          `  ${o.cheaper ? '🟢' : '🚩'} ${o.price.toFixed(2)} € (${o.delta > 0 ? '+' : ''}${o.delta} € / ${o.deltaPct}%) — ${o.place ?? '—'} · ${o.city ?? ''} · ${o.source ?? ''} · сходство ${o.similarity}`
        );
      }
    }
  }

  // Малко контролни примери, за да се види как се реже заглавието.
  for (const t of [
    'Олио слънчогледово 1 л',
    'Кафе Lavazza Qualità Oro 1 кг',
    'Пералня Samsung 8 кг',
    'Телевизор LG 55" 4K OLED',
    'Климатик Star-Light 12000 BTU',
  ]) {
    console.log(`  ключ: "${t}" → ${JSON.stringify(productTokens(t))}`);
  }
}

main()
  .catch((err) => {
    console.error('ГРЕШКА:', err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
