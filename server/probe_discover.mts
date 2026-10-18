/** Временна проба: как се държи проверката срещу реални магазини. */
import { checkShop, searchShops } from './src/lib/shopDiscovery.js';

const domains = process.argv.slice(2);
(async () => {
  for (const d of domains) {
    if (d.startsWith('find:')) {
      const found = await searchShops(d.slice(5), 10);
      console.log(`\n### ТЪРСЕНЕ „${d.slice(5)}“ → ${found.length} домейна`);
      for (const f of found) console.log(`   ${f.domain}  [${(f.seenBy || []).join(',')}]`);
      continue;
    }
    const t0 = Date.now();
    try {
      const c = await checkShop(d, { deadline: Date.now() + 40_000 });
      const s = c.sample[0];
      console.log(
        `\n${d}\n  status=${c.status} platform=${c.platform} strategy=${c.strategy} pages=${c.pagesProbed} http=${c.httpStatus} (${(Date.now() - t0) / 1000}s)\n  причина: ${c.reason}\n  пример: ${s ? `${(s.title || '').slice(0, 60)} | ${s.price} EUR | ${(s.imageUrl || '').slice(0, 60)}` : '—'}`
      );
    } catch (e) {
      console.log(`\n${d}\n  ГРЕШКА: ${(e as Error).message}`);
    }
  }
  process.exit(0);
})();
