import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  /**
   * ⚠️ 23.10.2026: беше 10 и при НАТОВАРВАНЕ заявките падаха с 500
   * („timeout exceeded when trying to connect“) — пулът се изчерпваше, докато
   * бавните заявки към големите таблици вървят. Един човек с отворено
   * приложение прави по 6-10 заявки наведнъж, а при презареждане — още толкова.
   * Постгресът позволява 100 връзки; 25 е безопасно и спира 500-ите.
   */
  max: 25,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // numeric → number (иначе pg връща низове и сметките в JS чупят)
  types: {
    getTypeParser: (typeId, format) => {
      if (typeId === 1700 /* NUMERIC */) return (val: string) => Number(val);
      if (typeId === 20 /* INT8 */) return (val: string) => Number(val);
      return pg.types.getTypeParser(typeId, format);
    },
  },
} as pg.PoolConfig);

export type SqlParam = unknown;

/** Единична заявка. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: SqlParam[] = []
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/** Първи ред или null. */
export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: SqlParam[] = []
): Promise<T | null> {
  const res = await query<T>(text, params);
  return res.rows[0] ?? null;
}

/** Всички редове. */
export async function many<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: SqlParam[] = []
): Promise<T[]> {
  const res = await query<T>(text, params);
  return res.rows;
}

/** Транзакция с автоматичен rollback при грешка. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
