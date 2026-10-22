/**
 * 🚗 БЕЗ АВТОМОБИЛИ В ОБЯВИТЕ (по заявка на собственика, 22.10.2026).
 *
 * Защо съществува: обявите от Facebook групи и от сайтовете за обяви (OLX,
 * Facebook Marketplace) пускаха и коли — „Обява за BMW i4 …“, „Двустаен
 * апартамент в Варна …“ (имотите също бяха спрени, но колите продължаваха да
 * влизат, защото AI-ят понякога не слага тема „Авто“, а „deals“/„Топ находка“).
 * Собственикът искаше в обявите да НЯМА автомобили.
 *
 * Как работи (два реда защита):
 *   1. при разчитане на пост/коментар — тема „Авто“ ИЛИ дума за кола в
 *      заглавието/описанието → записът се отбелязва като `rejected` и НИКОГА
 *      не се публикува (дори при включено автоодобрение);
 *   2. при внасяне от сайтовете за обяви — такава обява просто се прескача.
 * Трети ред: `approveFbReceiptItem()` отказва ръчно одобрение на кола.
 *
 * Изключва се с настройката `no_vehicles` = `off` в app_settings (обратимо, без
 * да се пипа кодът). По подразбиране е включено.
 *
 * Честност: не трием нищо — вече публикуваните коли се скриват (`status='hidden'`),
 * тоест могат да се върнат, ако човекът промени решението си.
 */
import { getSetting } from './settings.js';

/** Думи, които сами по себе си значат „кола“ (в каквато и да е форма). */
const CAR_WORDS = [
  'автомобил',
  'автомобили',
  'авто',
  'автобус',
  'автокъща',
  'авточасти',
  'автосервиз',
  'автоморга',
  'автосалон',
  'автостъкла',
  'автомивка',
  'автотехника',
  'автопилот',
  'джип',
  'пикап',
  'камион',
  'ремарке',
  'полуремарке',
  'караван',
  'кемпер',
  'мотоциклет',
  'мотоциклети',
  'мотопед',
  'скутер',
  'четириколка',
  'гуми',
  'джанти',
  'пробег',
  'километраж',
  'каско',
  'технически преглед',
  'резервни части',
];

/** Марки — „Ford“ примерно го има и в име на комплекс, затова е втори ред. */
const CAR_BRANDS = [
  'bmw',
  'audi',
  'mercedes-benz',
  'mercedes',
  'toyota',
  'honda',
  'nissan',
  'mazda',
  'hyundai',
  'renault',
  'peugeot',
  'citroen',
  'citroën',
  'dacia',
  'skoda',
  'volkswagen',
  'vw',
  'volvo',
  'subaru',
  'mitsubishi',
  'suzuki',
  'seat',
  'opel',
  'ford',
  'fiat',
  'jeep',
  'land rover',
  'range rover',
  'porsche',
  'lexus',
  'jaguar',
  'alfa romeo',
  'tesla',
  'chevrolet',
  'chery',
  'haval',
  'ssangyong',
  'kgm',
  'lada',
  'infiniti',
  'cadillac',
  'bentley',
  'ferrari',
  'lamborghini',
  'maserati',
  'mini cooper',
  'byd',
  'isuzu',
  'iveco',
  'scania',
  'daf',
  'aprilia',
  'yamaha',
  'kawasaki',
  'ducati',
  'piaggio',
  'vespa',
  'ktm',
  'great wall',
  'dongfeng',
];

/** Думи, които показват имот — при тях марка в името не значи кола. */
const REAL_ESTATE_WORDS = ['апартамент', 'наем', 'парцел', 'имоти', 'комплекс', 'брокер', 'кв.м', 'кв. м'];

/**
 * Думи за ДЕТСКИ/велосипедни неща — „детска акумулаторна кола Mercedes“,
 * „велосипед BMX“, „гуми за колело“ НЕ са автомобили и се показват.
 * Затова тези обяви не се пипат.
 */
const NOT_A_CAR_WORDS = [
  'акумулаторн',
  'велосипед',
  'колело',
  'детск',
  'играчка',
  'тротинет',
  'самокат',
  'bmx',
  'бмх',
];

/** „12V/24V“, „180W“ — така са описани само акумулаторните играчки. */
const TOY_POWER = /\b(?:6|12|24)\s?в\b|\b\d{2,3}\s?w\b/;

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

/** Регекс за цяла дума (кирилицата и цифрите не броят за граница). */
function wordRe(word: string): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${word.replace(ESCAPE, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'u');
}

/** Има ли текстът марка/дума за кола (без да брои имотите). */
export function isVehicleListing(...parts: Array<string | null | undefined>): boolean {
  const text = parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ')
    .toLowerCase();
  if (!text) return false;
  // Детски акумулаторни коли, велосипеди и „гуми за колело“ не са автомобили.
  if (NOT_A_CAR_WORDS.some((w) => text.includes(w)) || TOY_POWER.test(text)) return false;
  if (CAR_WORDS.some((w) => wordRe(w).test(text))) return true;
  const brand = CAR_BRANDS.some((b) => wordRe(b).test(text));
  if (!brand) return false;
  // Марка + думи за имот („комплекс Sunny Ford“) → не е кола.
  return !REAL_ESTATE_WORDS.some((w) => text.includes(w));
}

let cache: { at: number; on: boolean } | null = null;

/** Дали колите са изключени от обявите (настройка `no_vehicles`, по подразбиране „включено“). */
export async function vehiclesBlocked(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 60_000) return cache.on;
  let on = true;
  try {
    const raw = (await getSetting('no_vehicles', 'on')).trim().toLowerCase();
    on = raw !== 'off' && raw !== '0' && raw !== 'false';
  } catch {
    on = true;
  }
  cache = { at: Date.now(), on };
  return on;
}
