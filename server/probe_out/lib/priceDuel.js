/**
 * ⚔️ Ценова проверка — „същият продукт при друг доставчик“.
 *
 * Идеята: човекът плаща 8 € за 1 кг кафе, а същото кафе в магазина отсреща е
 * 6.50 €. Досега приложението показваше само една цена. Тук за всяка оферта
 * изчисляваме ДУЕЛА: кои други оферти са за същия продукт, колко по-евтини/скъпи
 * са те, и какво е присъдата за нашата цена (най-ниска / близка / по-скъпа /
 * чист обир).
 *
 * Мачването е по смислените думи в заглавието (без размери, мерни единици и
 * рекламни думи), за да хваща и „Олио 1 л“, и „Олио слънчогледово 1 л“, но да
 * не смесва „кафе Lavazza 1 кг“ с „кафе Carte Noire 1 кг“.
 *
 * Защо не в SQL: базата е с C колация (lower() не сгъва кирилица), а и тук
 * трябва да тежим съвпадението (брой общи думи), не просто LIKE. Базата има
 * под 1000 публикувани оферти, затова една заявка за кандидатите + сметката в
 * Node е мигновена и точна.
 */
import { many } from '../db.js';
/** Думи, които не носят смисъл за продукта (мерни единици, реклама, служебни). */
const STOP_WORDS = new Set([
    'за', 'на', 'от', 'и', 'с', 'със', 'до', 'при', 'или', 'не', 'се', 'евро',
    'евра', 'лева', 'лв', 'цена', 'цени', 'промо', 'промоция', 'намаление',
    'намален', 'бр', 'броя', 'брой', 'опаковка', 'пакет', 'размер', 'цвят',
    'модел', 'нови', 'ново', 'нова', 'използвано', 'използван', 'втора',
    'втора употреба', 'употреба', 'кг', 'гр', 'грама', 'мл', 'литър', 'литра',
    'см', 'мм', 'инч', 'бр.', 'бройки', 'бройка', 'пак', 'запечатан',
    'безплатна', 'доставка', 'доставката', 'отстъпка', 'подарък', 'комплект',
    'капак', 'кутия', 'оригинал', 'гаранция', 'качество', 'топ',
    // Цвят, пол, възраст и разфасовка — общи за СТОТИЦИ различни продукти.
    // „Детски маратонки elefanten, сини“ и „Детски маратонки PUMA, сини“ не са
    // един продукт само защото споделят „детски“, „маратонки“ и „сини“.
    'детски', 'детска', 'детско', 'дамски', 'дамска', 'мъжки', 'мъжка', 'женски',
    'женска', 'момче', 'момиче', 'момичета', 'бебе', 'бебешки', 'хлапе',
    'сини', 'син', 'синя', 'черни', 'черна', 'черно', 'бели', 'бяла', 'бяло',
    'червени', 'червена', 'червено', 'зелени', 'зелена', 'жълт', 'жълта',
    'лилави', 'лилава', 'розов', 'розова', 'розови', 'кафяви', 'кафява',
    'бежов', 'бежова', 'нюд', 'сив', 'сива', 'оранжев', 'тюркоаз', 'тъмно',
    'светло', 'малък', 'малка', 'малки', 'голям', 'голяма', 'големи', 'среден',
    'чифт', 'чифта', 'втора', 'употреба', 'марка',
]);
/** Смислените думи на заглавието — по тях сравняваме продуктите. */
export function productTokens(title) {
    const raw = String(title ?? '')
        .toLowerCase()
        .replace(/[^a-zа-я0-9]+/gi, ' ')
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 3)
        // „1“, „500“ сами не значат нищо — размерът не е продукт.
        .filter((w) => !/^\d+$/.test(w))
        .filter((w) => !STOP_WORDS.has(w));
    // Махаме повторенията, но пазим реда (първата дума обикновено е продуктът).
    const seen = new Set();
    const out = [];
    for (const w of raw) {
        if (seen.has(w))
            continue;
        seen.add(w);
        out.push(w);
        if (out.length >= 6)
            break;
    }
    return out;
}
/**
 * Колко си приличат две заглавия (0..1).
 * Изискваме да съвпадат ПОНЕ половината смислени думи на по-късото заглавие —
 * иначе „кафе“ щеше да съвпадне с всяко кафе в базата.
 */
export function titleSimilarity(a, b) {
    if (!a.length || !b.length)
        return 0;
    const setB = new Set(b);
    let common = 0;
    for (const w of a)
        if (setB.has(w))
            common += 1;
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    // Една обща дума при многосрични заглавия не е доказателство („кафе Lavazza“).
    if (shorter === 1)
        return common === 1 && longer <= 3 ? 1 : 0;
    return common / shorter;
}
/**
 * Числата в заглавието (модел, размер, разфасовка) — например 200651, 3367,
 * 12000, 8, 500.
 *
 * Защо са важни: „Отвертка Wera 3367“ и „Отвертка Wera 3350“ са различни
 * инструменти, а „Витамин D3 2000 IU x 60“ и „… x 120“ са различни разфасовки.
 * Ако и двете заглавия имат числа и НЕ си споделят нито едно — не са същият
 * продукт.
 */
export function numberSignature(title) {
    // И едноцифрените числа са важни: „6+“ срещу „0-6“ е друг вариант на продукта.
    const found = String(title ?? '').match(/\d+(?:[.,]\d+)?/g) ?? [];
    const out = [];
    for (const raw of found) {
        const n = Number(raw.replace(',', '.'));
        if (!Number.isFinite(n))
            continue;
        if (!out.includes(n))
            out.push(n);
    }
    return out;
}
/**
 * Едни и същи ли са продуктите.
 *
 * Правилата (всичките трябва да минат):
 *  1. поне ДВЕ общи смислени думи — след като цветът, полът, възрастта и
 *     разфасовката вече са изхвърлени (те са общи за стотици продукти);
 *  2. поне 75% от по-късото и поне 50% от по-дългото заглавие да съвпадат;
 *  3. числата (модел/размер/разфасовка) да си споделят поне едно, ако и двете
 *     заглавия имат числа.
 *
 * Защо така (реални примери, хванати на живо):
 *  • „Детски маратонки elefanten TIAM, сини“ (17.99 €) вече НЕ съвпада с
 *    „Детски маратонки PUMA Caven, сини“ (2.99 €) — общите думи (детски,
 *    маратонки, сини) вече не се броят за доказателство;
 *  • „Parodont Active Паста за зъби“ не съвпада с „Parodont Active Четка за
 *    зъби“ — съвпадението по марка + дума „зъби“ вече не е достатъчно (75%);
 *  • „Apivita Express Beauty маска за КОСА“ не съвпада с „… маска за ЛИЦЕ“.
 */
export function isSameProduct(a, b) {
    const setB = new Set(b);
    const common = a.filter((w) => setB.has(w) && w.length >= 3);
    // Еднодумни заглавия — само при точно съвпадение на дълга дума.
    if (a.length === 1 && b.length === 1)
        return a[0] === b[0] && a[0].length >= 5;
    if (common.length < 2)
        return false;
    if (common.length / Math.min(a.length, b.length) < 0.75)
        return false;
    if (common.length / Math.max(a.length, b.length) < 0.5)
        return false;
    // Дълги заглавия (5+ смислени думи) искат поне три общи — иначе е друга стока
    // от същата марка/серия.
    if (Math.max(a.length, b.length) >= 5 && common.length < 3)
        return false;
    return true;
}
/** Съвместими ли са размерите/моделите (числата) на двете заглавия. */
export function sizeCompatible(titleA, titleB) {
    const na = numberSignature(titleA);
    const nb = numberSignature(titleB);
    if (!na.length || !nb.length)
        return true;
    return na.some((n) => nb.includes(n));
}
const CANDIDATE_COLUMNS = `p.id, p.public_code, p.title, p.price_paid::float as price,
  p.place_name, p.city, p.source, p.platform_tag, p.image_url,
  p.created_at::text as created_at, p.address, p.google_maps_url`;
function verdictFor(saving, savingPct, twinCount) {
    if (twinCount === 0)
        return 'cheapest';
    if (saving <= 0.011)
        return 'cheapest'; // ние сме най-ниската (или равна) цена
    if (savingPct <= 8)
        return 'similar';
    if (savingPct <= 25)
        return 'pricier';
    return 'rip-off';
}
/**
 * Едно-единствено зареждане на кандидатите: взимаме всички публикувани оферти,
 * в чието заглавие има някоя от смислените думи на търсените оферти, и после
 * смятаме съвпадението в Node (точно, а не приблизително).
 */
async function loadCandidates(excludeIds, words) {
    const clean = Array.from(new Set(words.filter((w) => w.length >= 4))).slice(0, 60);
    if (!clean.length)
        return [];
    const patterns = clean.map((w) => `%${w}%`);
    return many(`select ${CANDIDATE_COLUMNS}
       from posts p
      where p.status = 'published'
        and p.price_paid > 0
        and not (p.id = any($1::uuid[]))
        and p.title ilike any($2::text[])
      order by p.price_paid asc
      limit 1500`, [excludeIds, patterns]);
}
function toTwin(row, myPrice, similarity) {
    const delta = Number((row.price - myPrice).toFixed(2));
    const deltaPct = myPrice > 0 ? Number(((delta / myPrice) * 100).toFixed(1)) : 0;
    return {
        id: row.id,
        code: row.public_code ?? null,
        title: row.title,
        price: row.price,
        place: row.place_name ?? null,
        city: row.city ?? null,
        source: row.source ?? null,
        platformTag: row.platform_tag ?? null,
        imageUrl: row.image_url ?? null,
        createdAt: row.created_at ?? null,
        address: row.address ?? null,
        mapsUrl: row.google_maps_url ?? null,
        delta,
        deltaPct,
        cheaper: delta < 0,
        similarity: Number(similarity.toFixed(2)),
    };
}
/**
 * Дуелът за една оферта: всички други цени за същия продукт + присъда.
 * Връща null, ако няма с какво да се сравни (тогава UI-ът не показва нищо —
 * по-добре нищо, отколкото празна карта).
 */
export async function priceDuel(postId) {
    const mine = await many(`select id, title, price_paid::float as price from posts
      where id = $1 and status = 'published'`, [postId]);
    const me = mine[0];
    if (!me || !(me.price > 0))
        return null;
    const myTokens = productTokens(me.title);
    if (!myTokens.length)
        return null;
    const candidates = await loadCandidates([postId], myTokens);
    // Един и същ продукт може да влезе два пъти от един магазин (различен адрес
    // на същия артикул). За дуела това е шум: броим МАГАЗИН + ЦЕНА веднъж, иначе
    // диаграмата показва три еднакви стълба и „3 конкурента“, които са един.
    const seen = new Set();
    const others = [];
    for (const row of candidates) {
        const tokens = productTokens(row.title);
        if (!isSameProduct(myTokens, tokens))
            continue;
        // Размер/модел/разфасовка трябва да си съвпадат (иначе 60 табл. срещу 120).
        if (!sizeCompatible(me.title, row.title))
            continue;
        const dedupeKey = `${(row.place_name ?? '').trim().toLowerCase()}|${row.price}`;
        if (seen.has(dedupeKey))
            continue;
        seen.add(dedupeKey);
        others.push(toTwin(row, me.price, titleSimilarity(myTokens, tokens)));
    }
    if (!others.length)
        return null;
    others.sort((a, b) => a.price - b.price);
    /**
     * ⚠️ Присъда и флагове САМО при почти идентични заглавия (≥0.9).
     *
     * Защо: при „същата серия, друг вариант“ („Always Platinum ULTRA“ срещу
     * „Always Platinum NORMAL“, „Astera Kids 6+“ срещу „0-6“) заглавията съвпадат
     * на 80–90% и цената може да е съвсем друга. Да твърдим „83% по-евтино
     * другаде“ на такава база е подвеждащо — затова тук такива оферти не влизат в
     * сметката (остават в списъка „Същият продукт другаде“ без присъда).
     */
    const strongly = others.filter((o) => o.similarity >= 0.9);
    if (!strongly.length)
        return null;
    const prices = strongly.map((o) => o.price);
    const cheapest = strongly[0];
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    // Положително = ние плащаме повече от най-евтината друга оферта.
    const saving = Number(Math.max(0, me.price - cheapest.price).toFixed(2));
    const savingPct = me.price > 0 ? Number(((saving / me.price) * 100).toFixed(1)) : 0;
    const overAvgPct = avg > 0 ? Number((((me.price - avg) / avg) * 100).toFixed(1)) : 0;
    return {
        twinCount: strongly.length,
        cheapestPrice: cheapest.price,
        cheapestPlace: cheapest.place,
        cheapestId: cheapest.id,
        saving,
        savingPct,
        verdict: verdictFor(saving, savingPct, strongly.length),
        myPrice: me.price,
        minPrice: Math.min(...prices, me.price),
        maxPrice: Math.max(...prices, me.price),
        avgPrice: Number(avg.toFixed(2)),
        overAvgPct,
        others: strongly.slice(0, 12),
    };
}
/**
 * Кратката цена-проверка за ЦЯЛА страница от лентата наведнъж (един SQL за
 * всички оферти на екрана — иначе всяка карта щеше да прави своя заявка и
 * лентата щеше да „забива“).
 */
export async function compareForPosts(ids) {
    const out = new Map();
    if (!ids.length)
        return out;
    const mine = await many(`select id, title, price_paid::float as price from posts
      where status = 'published' and id = any($1::uuid[])`, [ids]);
    if (!mine.length)
        return out;
    const tokensById = new Map();
    const allWords = [];
    for (const row of mine) {
        const t = productTokens(row.title);
        tokensById.set(row.id, t);
        allWords.push(...t.slice(0, 2));
    }
    const candidates = await loadCandidates(ids, allWords);
    const withTokens = candidates.map((row) => ({ row, tokens: productTokens(row.title) }));
    for (const row of mine) {
        const myTokens = tokensById.get(row.id) ?? [];
        if (!myTokens.length)
            continue;
        // Един магазин + една цена = един конкурент (иначе дубликатните оферти от
        // един и същ магазин се броят няколко пъти и чипът лъже „5 места“).
        const seenTwin = new Set();
        const twins = [];
        for (const c of withTokens) {
            if (!isSameProduct(myTokens, c.tokens))
                continue;
            if (!sizeCompatible(row.title, c.row.title))
                continue;
            const sim = titleSimilarity(myTokens, c.tokens);
            // В чипа в лентата влизат само почти идентични заглавия — иначе човекът
            // вижда твърдение „по-скъпо с 80%“, което се отнася за друг вариант на
            // продукта (същата серия, различен размер/вид).
            if (sim < 0.9)
                continue;
            const dedupeKey = `${(c.row.place_name ?? '').trim().toLowerCase()}|${c.row.price}`;
            if (seenTwin.has(dedupeKey))
                continue;
            seenTwin.add(dedupeKey);
            twins.push({ row: c.row, sim });
        }
        if (!twins.length)
            continue;
        const cheapestTwin = twins.reduce((best, c) => (c.row.price < best.row.price ? c : best), twins[0]);
        // Положително = ние плащаме повече от най-евтината друга оферта.
        const saving = Number(Math.max(0, row.price - cheapestTwin.row.price).toFixed(2));
        const savingPct = row.price > 0 ? Number(((saving / row.price) * 100).toFixed(1)) : 0;
        out.set(row.id, {
            twinCount: twins.length,
            cheapestPrice: cheapestTwin.row.price,
            cheapestPlace: cheapestTwin.row.place_name ?? null,
            cheapestId: cheapestTwin.row.id,
            saving,
            savingPct,
            verdict: verdictFor(saving, savingPct, twins.length),
            twinTitles: twins.slice(0, 4).map((t) => t.row.title),
        });
    }
    return out;
}
