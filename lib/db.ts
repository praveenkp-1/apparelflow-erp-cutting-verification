import bcrypt from 'bcryptjs';
import { SCHEMA } from './schema';

export interface Db {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

const wrapPglite = (p: any): Db => ({
  query: async (s, a = []) => (await p.query(s, a)).rows,
  exec: async (s) => { await p.exec(s); },
  tx: (fn) => p.transaction((t: any) => fn(wrapPglite(t))),
});

const wrapPg = (c: any, pool?: any): Db => ({
  query: async (s, a = []) => (await c.query(s, a)).rows,
  exec: async (s) => { await c.query(s); },
  tx: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(wrapPg(client));
      await client.query('COMMIT');
      return r;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  },
});

export const DEMO_PASSWORD = 'Demo@1234';
const DEMO_USERS = [
  ['supervisor@apparelflow.demo', 'cutting_supervisor', 'Nimali Perera (Cutting Supervisor)'],
  ['verifier@apparelflow.demo', 'cutting_verifier', 'Kasun Fernando (Cutting Verifier)'],
  ['sewing@apparelflow.demo', 'sewing_supervisor', 'Dilani Silva (Sewing Supervisor)'],
];
const RECIPES = [
  ['REC-BL01', 'Casual Blouse', 'Blouse', 1.8, 5.0, [['Front Body Panel', 1], ['Back Body Panel', 1], ['Sleeves (Left & Right)', 2], ['Collar & Stand', 1], ['Sleeve Cuffs', 2]]],
  ['REC-CT02', 'Crop Top', 'Crop Top', 1.1, 8.0, [['Front Chest Panel', 1], ['Back Support Panel', 1], ['Neck Binding Strip', 1], ['Hem Elastic Casing', 1], ['Side Strap Accents', 2]]],
] as const;

async function seed(db: Db) {
  const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
  if (n > 0) return;
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const [email, role, name] of DEMO_USERS)
    await db.query('INSERT INTO users(email,password_hash,role,full_name) VALUES($1,$2,$3,$4)', [email, hash, role, name]);
  for (const [code, name, cat, yds, cap, comps] of RECIPES) {
    const [r] = await db.query<{ id: number }>(
      'INSERT INTO recipes(recipe_code,name,category,std_fabric_yards,wastage_cap) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [code, name, cat, yds, cap]);
    for (const [cn, pcs] of comps)
      await db.query('INSERT INTO recipe_components(recipe_id,component_name,pieces_per_garment) VALUES($1,$2,$3)', [r.id, cn, pcs]);
  }
}

/** DATABASE_URL -> Postgres (production). Otherwise embedded Postgres (file-backed, or in-memory for tests). */
export async function createDb(opts: { memory?: boolean } = {}): Promise<Db> {
  let db: Db;
  if (process.env.DATABASE_URL && !opts.memory) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
    db = wrapPg(pool, pool);
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    if (!opts.memory) (await import('node:fs')).mkdirSync('./.data', { recursive: true });
    db = wrapPglite(new PGlite(opts.memory ? undefined : './.data/pg'));
  }
  await db.exec(SCHEMA);
  await seed(db);
  return db;
}

const g = globalThis as unknown as { __afDb?: Promise<Db> };
export const getDb = () => (g.__afDb ??= createDb());
