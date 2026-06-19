import express from "express";
import cors from "cors";
import { db, settings, wordCache, progress, type BookmarkRow } from "./db.js";
import { fetchList, fetchWord, probeAuth } from "./kotobank.js";

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

app.get("/api/bookmarks", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM bookmarks ORDER BY created_at DESC, id DESC")
    .all() as BookmarkRow[];
  res.json(rows);
});

app.post("/api/bookmarks", (req, res) => {
  const { term, url, page, excerpt, note } = req.body as Partial<BookmarkRow>;
  if (!term || !url) return res.status(400).json({ error: "term と url が必要です" });
  try {
    const info = db
      .prepare(
        `INSERT INTO bookmarks (term, url, page, excerpt, note)
         VALUES (@term, @url, @page, @excerpt, @note)`
      )
      .run({
        term,
        url,
        page: page ?? null,
        excerpt: excerpt ?? "",
        note: note ?? "",
      });
    const row = db
      .prepare("SELECT * FROM bookmarks WHERE id = ?")
      .get(info.lastInsertRowid) as BookmarkRow;
    res.status(201).json(row);
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) {
      const row = db.prepare("SELECT * FROM bookmarks WHERE url = ?").get(url);
      return res.status(200).json(row);
    }
    throw e;
  }
});

app.patch("/api/bookmarks/:id", (req, res) => {
  const id = Number(req.params.id);
  const { note } = req.body as { note?: string };
  db.prepare("UPDATE bookmarks SET note = ? WHERE id = ?").run(note ?? "", id);
  const row = db.prepare("SELECT * FROM bookmarks WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});

app.delete("/api/bookmarks/:id", (req, res) => {
  db.prepare("DELETE FROM bookmarks WHERE id = ?").run(Number(req.params.id));
  res.status(204).end();
});

// URL でしおり削除（カード上のトグル用）
app.delete("/api/bookmarks", (req, res) => {
  const url = String(req.query.url ?? "");
  if (!url) return res.status(400).json({ error: "url が必要です" });
  db.prepare("DELETE FROM bookmarks WHERE url = ?").run(url);
  res.status(204).end();
});

/* ------------------------------ 読書の進捗 ------------------------------ */

app.get("/api/progress", (_req, res) => {
  res.json(progress.get());
});

app.put("/api/progress", (req, res) => {
  const { page, itemIndex, url, term } = req.body as {
    page?: number;
    itemIndex?: number;
    url?: string;
    term?: string;
  };
  if (page == null || itemIndex == null || !url || !term) {
    return res.status(400).json({ error: "page, itemIndex, url, term が必要です" });
  }
  progress.set({ page, itemIndex, url, term });
  res.json(progress.get());
});

/* -------------------------------- 認証 -------------------------------- */

app.get("/api/auth", (_req, res) => {
  const cookie = settings.get("kotobank_cookie");
  res.json({
    hasCookie: Boolean(cookie),
    cookiePreview: cookie ? cookie.slice(0, 24) + (cookie.length > 24 ? "…" : "") : null,
  });
});

app.post("/api/auth/cookie", (req, res) => {
  const { cookie } = req.body as { cookie?: string };
  if (!cookie || !cookie.trim()) return res.status(400).json({ error: "cookie が必要です" });
  settings.set("kotobank_cookie", cookie.trim());
  res.json({ ok: true });
});

app.delete("/api/auth/cookie", (_req, res) => {
  settings.delete("kotobank_cookie");
  res.json({ ok: true });
});

app.get(
  "/api/auth/probe",
  asyncRoute(async (_req, res) => {
    const result = await probeAuth();
    res.json(result);
  })
);

/* ------------------------------ キャッシュ ------------------------------ */

app.delete("/api/cache", (_req, res) => {
  wordCache.clear();
  res.json({ ok: true });
});

/* ------------------------------ エラー処理 ------------------------------ */

app.use(((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err?.message ?? "internal error" });
}) as express.ErrorRequestHandler);

app.listen(PORT, () => {
  console.log(`[server] kotobank ブリタニカ ビューア API: http://localhost:${PORT}`);
});
