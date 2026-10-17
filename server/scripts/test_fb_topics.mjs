/* Жива проверка на темите (интересите) — пуска се ВЪТРЕ в контейнера:
   docker exec -i smartprice-api node --input-type=module - < server/topic_test_direct.mjs  */
const m = await import('/app/dist/lib/fbReceipts.js');

const enabled = (await m.getFbTopics()).map((t) => t.key);
console.log('включени теми:', enabled.join(', '));

const cases = [
  ['services', 'Пловдив, виках фирма МастерКлима — поискаха ми 80 евро за профилактика и почистване на два климатика.'],
  ['real_estate', 'София, квартал Лозенец — двустаен апартамент под наем за 650 евро на месец, без такса на агенцията.'],
  ['masters', 'Бургас, търсих майстор за плочки. Майстор Стоян поиска 35 евро на квадратен метър за лепене.'],
  ['shops_places', 'Сливен, на бул. България отвори нов магазин — 1 кг домати 2.20 евро, според мен е скъпо.'],
  ['deals', 'Варна, Lidl — пилешко филе 1 кг е 4.99 евро, виждам го на етикета.'],
];

for (const [expect, text] of cases) {
  try {
    const r = await m.analyzeFbReceiptWithAi({
      imageDataUrl: null,
      fbPostText: text,
      defaultCity: 'София',
      authorAlias: 'Мария',
    });
    console.log(
      JSON.stringify({
        expect,
        topic: r.topic,
        kind: r.kind,
        category: r.category,
        city: r.city,
        place: r.placeName,
        eur: r.totalAmountEur,
        accepted: r.isReceipt,
        skip: r.skipReason,
      })
    );
  } catch (e) {
    console.log(JSON.stringify({ expect, error: String(e).slice(0, 160) }));
  }
}
