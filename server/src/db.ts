import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "環境変数 DATABASE_URL が設定されていません。Supabase の接続文字列を設定してください。"
  );
}

// Supabase は SSL 必須。pg のデフォルト検証では弾かれることがあるため緩める。
const useSsl = !/sslmode=disable/.test(connectionString);

export const pool = new pg.Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id         SERIAL PRIMARY KEY,
      term       TEXT NOT NULL,
      url        TEXT NOT NULL UNIQUE,
      page       INTEGER,
      note       TEXT DEFAULT '',
      excerpt    TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS word_cache (
      url        TEXT PRIMARY KEY,
      headword   TEXT,
      body_html  TEXT,
      fetched_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      page       INTEGER,
      item_index INTEGER,
      url        TEXT,
      term       TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

export type BookmarkRow = {
  id: number;
  term: string;
  url: string;
  page: number | null;
  note: string;
  excerpt: string;
  created_at: string;
};

export const settings = {
  async get(key: string): Promise<string | null> {
    const r = await pool.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = $1",
      [key]
    );
    return r.rows[0]?.value ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  },
  async delete(key: string): Promise<void> {
    await pool.query("DELETE FROM settings WHERE key = $1", [key]);
  },
};

export type ProgressRow = {
  page: number;
  item_index: number;
  url: string;
  term: string;
  updated_at: string;
};

export const progress = {
  async get(): Promise<ProgressRow | null> {
    const r = await pool.query<ProgressRow>(
      "SELECT page, item_index, url, term, updated_at FROM reading_progress WHERE id = 1"
    );
    return r.rows[0] ?? null;
  },
  async set(p: { page: number; itemIndex: number; url: string; term: string }): Promise<void> {
    await pool.query(
      `INSERT INTO reading_progress (id, page, item_index, url, term, updated_at)
       VALUES (1, $1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET
         page = EXCLUDED.page,
         item_index = EXCLUDED.item_index,
         url = EXCLUDED.url,
         term = EXCLUDED.term,
         updated_at = EXCLUDED.updated_at`,
      [p.page, p.itemIndex, p.url, p.term]
    );
  },
};

export type WordCacheRow = {
  headword: string;
  body_html: string;
  fetched_at: string;
};

export const wordCache = {
  async get(url: string): Promise<WordCacheRow | undefined> {
    const r = await pool.query<WordCacheRow>(
      "SELECT headword, body_html, fetched_at FROM word_cache WHERE url = $1",
      [url]
    );
    return r.rows[0];
  },
  async set(url: string, headword: string, bodyHtml: string): Promise<void> {
    await pool.query(
      `INSERT INTO word_cache (url, headword, body_html, fetched_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (url) DO UPDATE SET
         headword = EXCLUDED.headword,
         body_html = EXCLUDED.body_html,
         fetched_at = EXCLUDED.fetched_at`,
      [url, headword, bodyHtml]
    );
  },
  async clear(): Promise<void> {
    await pool.query("DELETE FROM word_cache");
  },
};
