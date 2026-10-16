/**
 * Внасяне на продукти, обходени ИЗВЪН сървъра (от домашна машина с български IP).
 *
 * Защо съществува: част от магазините (remedium.bg, sopharmacy.bg, zora.bg…)
 * са зад Cloudflare и връщат 403 „Just a moment…“ на датацентъра, но се
 * отварят нормално от потребителски IP. За тях пускаме локален скрипт
 * (`scripts/scrape_local.py`), който чете продуктите и ги праща тук.
 *
 * Ползва СЪЩИТЕ правила като вградения скрапер: офертата излиза под профила
 * „SmartPrice Редакция“, с източник `scraper`, линк към продукта, етикет
 * „Онлайн магазин“; описaнието минава през stripShopMentions (без име на сайт).
 */
import { one, query } from '../db.js';
import {
  stripShopMentions,
  guessCategory,
  normalizeCurrency,
  officialProfileId,
  downloadImage,
} from './scraper.js';

export interface ExternalItem {
  title: string;
  url: string;
  price: number;
  currency?: string;
  imageUrl?: string;
  description?: string;
  /** Дали е на промоция (зачертана редовна цена). */
  listPrice?: number;
}

export interface ExternalImportResult {
  imported: number;
  skipped: number;
  skippedReasons: string[];
}

/** Внася списък продукти, обходени отвън. Връща колко са влезли и колко са прескочени. */
export async function importExternalProducts(
  domain: string,
  items: ExternalItem[]
): Promise<ExternalImportResult> {
  const authorId = await officialProfileId();
  const shopLabel = domain.replace(/^www\./, '');
  let imported = 0;
  let skipped = 0;
  const skippedReasons: string[] = [];

  for (const item of items) {
    const url = (item.url || '').trim();
    const title = (item.title || '').trim().slice(0, 200);
    const price = Number(item.price);

    if (!url || !title || !Number.isFinite(price) || price <= 0 || price > 1_000_000) {
      skipped += 1;
      skippedReasons.push(`${title.slice(0, 40) || url.slice(0, 40)}: няма заглавие/цена`);
      continue;
    }
    if (!/^https?:/i.test(url)) {
      skipped += 1;
      skippedReasons.push(`${title.slice(0, 40)}: невалиден адрес`);
      continue;
    }

    // Дедупликация по адрес на продукта — същият продукт не влиза два пъти.
    const exists = await one<{ id: string }>('select id from posts where source_url = $1 limit 1', [url]);
    if (exists) {
      skipped += 1;
      skippedReasons.push(`${title.slice(0, 40)}: вече е в приложението`);
      continue;
    }

    const { priceEur } = normalizeCurrency(price, item.currency, `${title} ${item.currency ?? ''}`);
    const listRaw = item.listPrice && item.listPrice > price ? item.listPrice : undefined;
    const reference = listRaw
      ? normalizeCurrency(listRaw, item.currency, `${title} ${item.currency ?? ''}`).priceEur
      : null;

    // Снимката я теглим на сървъра (иначе чуждият сайт може да я блокира за
    // показване) — при неуспех остава оригиналният адрес.
    let imageUrl = (item.imageUrl || '').trim().slice(0, 600);
    if (/^https?:/i.test(imageUrl)) {
      try {
        const local = await downloadImage(imageUrl, 5, { respectRobots: false, delayMs: 0 });
        if (local) imageUrl = local;
      } catch {
        /* оставяме оригиналния адрес */
      }
    }

    const description = stripShopMentions(
      item.description?.slice(0, 1200) || `${title} — цена от онлайн магазин.`,
      shopLabel
    ).slice(0, 4000);

    const tags = [shopLabel, '#ТопНаходка'].map((t) => (t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`));

    await query(
      `insert into posts (
         author_id, polarity, category, platform_tag, title, description,
         place_name, city, price_paid, reference_price, currency,
         image_url, tags, seller_type, source, source_note, source_url
       ) values (
         $1,'green',$2,'Онлайн магазин',$3,$4,$5,'Онлайн',$6,$7,'EUR',$8,$9,'business','scraper',$10,$11
       )`,
      [
        authorId,
        guessCategory(`${title} ${description}`),
        title,
        description,
        shopLabel.slice(0, 200),
        Number(priceEur.toFixed(2)),
        reference,
        imageUrl,
        tags.slice(0, 8),
        `Онлайн магазин ${shopLabel}: ${url}`.slice(0, 300),
        url.slice(0, 500),
      ]
    );
    imported += 1;
  }

  return { imported, skipped, skippedReasons: skippedReasons.slice(0, 30) };
}
