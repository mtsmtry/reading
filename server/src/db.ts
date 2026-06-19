import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "..", "data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "reader.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    term       TEXT    NOT NULL,
    url        TEXT    NOT NULL UNIQUE,
    page       INTEGER,
    note       TEXT    DEFAULT '',
    excerpt    TEXT    DEFAULT '',
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- 取得済み本文のローカルキャッシュ（サーバー負荷軽減のため）
  CREATE TABLE IF NOT EXISTS word_cache (
    url        TEXT PRIMARY KEY,
    headword   TEXT,
    body_html  TEXT,
    fetched_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- 読書の進捗（「どこまで読んだか」を1行で保持して次回復帰に使う）
  CREATE TABLE IF NOT EXISTS reading_progress (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    page       INTEGER,
    item_index INTEGER,
    url        TEXT,
    term       TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

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
  get(key: string): string | null {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },
  set(key: string, value: string) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, value);
  },
  delete(key: string) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
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
  get(): ProgressRow | null {
    const row = db
      .prepare("SELECT page, item_index, url, term, updated_at FROM reading_progress WHERE id = 1")
      .get() as ProgressRow | undefined;
    return row ?? null;
  },
  set(p: { page: number; itemIndex: number; url: string; term: string }) {
    db.prepare(
      `INSERT INTO reading_progress (id, page, item_index, url, term, updated_at)
       VALUES (1, @page, @itemIndex, @url, @term, datetime('now','localtime'))
       ON CONFLICT(id) DO UPDATE SET
         page = excluded.page,
         item_index = excluded.item_index,
         url = excluded.url,
         term = excluded.term,
         updated_at = excluded.updated_at`
    ).run(p);
  },
};

export const wordCache = {
  get(url: string): { headword: string; body_html: string; fetched_at: string } | undefined {
    return db
      .prepare("SELECT headword, body_html, fetched_at FROM word_cache WHERE url = ?")
      .get(url) as any;
  },
  set(url: string, headword: string, bodyHtml: string) {
    db.prepare(
      `INSERT INTO word_cache (url, headword, body_html, fetched_at)
       VALUES (?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(url) DO UPDATE SET
         headword = excluded.headword,
         body_html = excluded.body_html,
         fetched_at = excluded.fetched_at`
    ).run(url, headword, bodyHtml);
  },
  clear() {
    db.prepare("DELETE FROM word_cache").run();
  },
};
