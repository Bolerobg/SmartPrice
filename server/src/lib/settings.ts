/**
 * Настройки на приложението (таблица app_settings, ключ/стойност).
 *
 * Пазим тук само НЕтайни неща — например дали сайтът е в демо режим. Пароли и
 * ключове стоят в .env, не в базата.
 */
import { one, query } from '../db.js';

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const row = await one<{ value: string }>('select value from app_settings where key = $1', [key]);
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `insert into app_settings (key, value, updated_at) values ($1,$2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value]
  );
}

/**
 * Демо режим: сайтът се използва за проби, демонстрации и снимки — НЕ е на живо.
 *
 * Само в този режим демо играчът може да участва в томбола и в публичните
 * екрани да изглежда като обикновен участник. В реален режим това е забранено:
 * реалните хора не бива да виждат измислен победител.
 */
export async function isDemoMode(): Promise<boolean> {
  return (await getSetting('demo_mode', 'off')) === 'on';
}

export async function setDemoMode(on: boolean): Promise<void> {
  await setSetting('demo_mode', on ? 'on' : 'off');
}
