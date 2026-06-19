import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { pool, settings, wordCache, progress, initDb, type BookmarkRow } from "./db.js";
import { fetchList, fetchWord, probeAuth } from "./kotobank.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 5174;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function asyncRoute(fn: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/* ----------------------------- 一覧 / 項目 ----------------------------- */

app.get(
  "/api/list/:page",
  asyncRoute(async (req, res) => {
    const page = Math.max(1, Number(req.params.page) || 1);
    const result = await fetchList(page);
    res.json(result);
  })
);

app.post(
  "/api/word",
  asyncRoute(async (req, res) => {
    const { url, force } = req.body as { url?: string; force?: boolean };
    if (!url) return res.status(400).json({ error: "url が必要です" });
    const result = await fetchWord(url, Boolean(force));
    res.json(result);
  })
);

/* ------------------------------- しおり ------------------------------- */

app.get(
  "/api/bookmarks",
  asyncRoute(async (_req, res) => {
    const r = await pool.query<BookmarkRow>(
      "SELECT * FROM bookmarks ORDER BY created_at DESC, id DESC"
    );
    res.json(r.rows);
  })
);

app.post(
  "/api/bookmarks",
  asyncRoute(async (req, res) => {
    const { term, url, page, excerpt, note } = req.body as Partial<BookmarkRow>;
    if (!term || !url) return res.status(400).json({ error: "term と url が必要です" });
    const r = await pool.query<BookmarkRow>(
      `INSERT INTO bookmarks (term, url, page, excerpt, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (url) DO UPDATE SET term = EXCLUDED.term
       RETURNING *`,
      [term, url, page ?? null, excerpt ?? "", note ?? ""]
    );
    res.status(201).json(r.rows[0]);
  })
);

app.patch(
  "/api/bookmarks/:id",
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const { note } = req.body as { note?: string };
    const r = await pool.query<BookmarkRow>(
      "UPDATE bookmarks SET note = $1 WHERE id = $2 RETURNING *",
      [note ?? "", id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "not found" });
    res.json(r.rows[0]);
  })
);

app.delete(
  "/api/bookmarks/:id",
  asyncRoute(async (req, res) => {
    await pool.query("DELETE FROM bookmarks WHERE id = $1", [Number(req.params.id)]);
    res.status(204).end();
  })
);

// URL でしおり削除（カード上のトグル用）
app.delete(
  "/api/bookmarks",
  asyncRoute(async (req, res) => {
    const url = String(req.query.url ?? "");
    if (!url) return res.status(400).json({ error: "url が必要です" });
    await pool.query("DELETE FROM bookmarks WHERE url = $1", [url]);
    res.status(204).end();
  })
);

/* ------------------------------ 読書の進捗 ------------------------------ */

app.get(
  "/api/progress",
  asyncRoute(async (_req, res) => {
    res.json(await progress.getState());
  })
);

app.put(
  "/api/progress",
  asyncRoute(async (req, res) => {
    const { page, itemIndex, url, term } = req.body as {
      page?: number;
      itemIndex?: number;
      url?: string;
      term?: string;
    };
    if (page == null || itemIndex == null || !url || !term) {
      return res.status(400).json({ error: "page, itemIndex, url, term が必要です" });
    }
    const state = await progress.record({ page, itemIndex, url, term });
    res.json(state);
  })
);

/* -------------------------------- 認証 -------------------------------- */

app.get(
  "/api/auth",
  asyncRoute(async (_req, res) => {
    const cookie = await settings.get("kotobank_cookie");
    res.json({
      hasCookie: Boolean(cookie),
      cookiePreview: cookie ? cookie.slice(0, 24) + (cookie.length > 24 ? "…" : "") : null,
    });
  })
);

app.post(
  "/api/auth/cookie",
  asyncRoute(async (req, res) => {
    const { cookie } = req.body as { cookie?: string };
    if (!cookie || !cookie.trim()) return res.status(400).json({ error: "cookie が必要です" });
    await settings.set("kotobank_cookie", cookie.trim());
    res.json({ ok: true });
  })
);

app.delete(
  "/api/auth/cookie",
  asyncRoute(async (_req, res) => {
    await settings.delete("kotobank_cookie");
    res.json({ ok: true });
  })
);

app.get(
  "/api/auth/probe",
  asyncRoute(async (_req, res) => {
    const result = await probeAuth();
    res.json(result);
  })
);

/* ------------------------------ キャッシュ ------------------------------ */

app.delete(
  "/api/cache",
  asyncRoute(async (_req, res) => {
    await wordCache.clear();
    res.json({ ok: true });
  })
);

/* -------------------- 本番: ビルド済みフロントを配信 -------------------- */

const clientDist = join(__dirname, "..", "..", "client", "dist");
if (process.env.NODE_ENV === "production" && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(clientDist, "index.html"));
  });
}

/* ------------------------------ エラー処理 ------------------------------ */

app.use(((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err?.message ?? "internal error" });
}) as express.ErrorRequestHandler);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] kotobank ブリタニカ ビューア API: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[server] DB 初期化に失敗しました:", err);
    process.exit(1);
  });
