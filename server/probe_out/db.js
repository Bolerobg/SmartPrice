import pg from 'pg';
import { env } from './env.js';
const { Pool } = pg;
export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // numeric → number (иначе pg връща низове и сметките в JS чупят)
    types: {
        getTypeParser: (typeId, format) => {
            if (typeId === 1700 /* NUMERIC */)
                return (val) => Number(val);
            if (typeId === 20 /* INT8 */)
                return (val) => Number(val);
            return pg.types.getTypeParser(typeId, format);
        },
    },
});
/** Единична заявка. */
export async function query(text, params = []) {
    return pool.query(text, params);
}
/** Първи ред или null. */
export async function one(text, params = []) {
    const res = await query(text, params);
    return res.rows[0] ?? null;
}
/** Всички редове. */
export async function many(text, params = []) {
    const res = await query(text, params);
    return res.rows;
}
/** Транзакция с автоматичен rollback при грешка. */
export async function tx(fn) {
    const client = await pool.connect();
    try {
        await client.query('begin');
        const result = await fn(client);
        await client.query('commit');
        return result;
    }
    catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
export async function closePool() {
    await pool.end();
}
