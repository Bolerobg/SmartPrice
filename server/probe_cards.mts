import { politeFetch, extractListingProducts, extractGenericPrice, strictCardPrice } from './src/lib/scraper.js';

const url = process.argv[2];
(async () => {
  const res = await politeFetch(url, { timeoutMs: 20000 });
  console.log('bytes', res.text.length, 'status', res.status);
  const cards = extractListingProducts(res.text, res.url);
  console.log('cards:', cards.length);
  for (const c of cards.slice(0, 4)) console.log('  ', JSON.stringify({ t: c.title, p: c.price, i: (c.imageUrl || '').slice(0, 50) }));
  console.log('genericPrice', JSON.stringify(extractGenericPrice(res.text)));
  console.log('strictCardPrice', JSON.stringify(strictCardPrice(res.text)));
  const i = res.text.indexOf('price_color');
  console.log('ctx:', res.text.slice(Math.max(0, i - 300), i + 200).replace(/\s+/g, ' '));
  process.exit(0);
})();
