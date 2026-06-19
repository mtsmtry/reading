import * as cheerio from "cheerio";
import { settings, wordCache } from "./db.js";

const BASE = "https://kotobank.jp";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// kotobank への負荷を抑えるための簡易レートリミッタ（最小リクエスト間隔）
const MIN_INTERVAL_MS = 300;
let lastFetch = 0;
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, lastFetch + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  return fn();
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept-Language": "ja,en;q=0.8",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  };
  const cookie = settings.get("kotobank_cookie");
  if (cookie) headers["Cookie"] = cookie;
  return headers;
}

async function fetchHtml(url: string): Promise<string> {
  return paced(async () => {
    const res = await fetch(url, { headers: authHeaders(), redirect: "follow" });
    if (!res.ok) {
      throw new Error(`kotobank への取得に失敗しました (${res.status} ${res.statusText}): ${url}`);
    }
    return res.text();
  });
}

export type ListItem = {
  term: string;
  href: string; // 絶対URL
};

// /word/<slug>-<id>#... の末尾IDを抽出（アンカーは無視）
function wordIdFromHref(href: string): string | null {
  const path = href.split("#")[0].split("?")[0];
  const m = path.match(/-(\d+)\/?$/);
  return m ? m[1] : null;
}

export type ListResult = {
  page: number;
  items: ListItem[];
  pageNumbers: number[];
  hasPrev: boolean;
  hasNext: boolean;
  rangeLabel: string | null;
};

export async function fetchList(page: number): Promise<ListResult> {
  const url = page <= 1 ? `${BASE}/dictionary/britannica/` : `${BASE}/dictionary/britannica/${page}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const items: ListItem[] = [];
  const seenIds = new Set<string>();
  $('ul.grid02 li a[rel="dic_britannica"]').each((_, el) => {
    const a = $(el);
    const href = a.attr("href") ?? "";
    const term = a.find("span").text().trim() || a.text().trim();
    if (!href || !term) return;
    // 参照先URLの末尾IDで同一性を判定し、重複（連続表示など）を排除
    const id = wordIdFromHref(href);
    if (id) {
      if (seenIds.has(id)) return;
      seenIds.add(id);
    }
    items.push({ term, href: href.startsWith("http") ? href : BASE + href });
  });

  const pageNumbers = new Set<number>();
  $(".pagination a").each((_, el) => {
    const m = $(el).attr("href")?.match(/\/dictionary\/britannica\/(\d+)\//);
    if (m) pageNumbers.add(Number(m[1]));
  });
  pageNumbers.add(page);

  const hasNext = $(".pagination .next a").length > 0;
  const hasPrev = page > 1;

  // タイトルの「○件目から○件目」を抽出
  const title = $("title").text();
  const rangeMatch = title.match(/(\d+件目から\d+件目)/);

  return {
    page,
    items,
    pageNumbers: [...pageNumbers].sort((a, b) => a - b),
    hasPrev,
    hasNext,
    rangeLabel: rangeMatch ? rangeMatch[1] : null,
  };
}

export type WordResult = {
  url: string;
  headword: string;
  bodyHtml: string;
  cached: boolean;
  fetchedAt: string;
};

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

function extractBritannica(html: string): { headword: string; bodyHtml: string } | null {
  const $ = cheerio.load(html);
  const article = $("article.britannica").first();
  if (article.length === 0) return null;

  // 不要要素を除去（サイト見出し・出典表記・広告/スポンサー枠など）
  article.find("> h2").remove();
  article
    .find(
      ".pc-word-ad, .page_link_marker, script, style, ins, iframe, " +
        "p.source, .source, .kyujinbox-ad, .ky-ad, .ky-logo"
    )
    .remove();

  // 見出し語（h3 の <br> を改行に）
  const h3 = article.find("h3").first();
  h3.find("br").replaceWith("\n");
  const headword = h3.text().trim().split("\n").filter(Boolean).join(" / ");

  // 相対リンクを絶対URL化し、別タブで開く
  article.find("a[href]").each((_, el) => {
    const a = $(el);
    const href = a.attr("href") ?? "";
    if (href.startsWith("/")) a.attr("href", BASE + href);
    a.attr("target", "_blank");
    a.attr("rel", "noopener noreferrer");
  });

  const bodyHtml = (article.html() ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  return { headword, bodyHtml };
}

export async function fetchWord(rawUrl: string, force = false): Promise<WordResult> {
  const url = rawUrl.startsWith("http") ? rawUrl : BASE + rawUrl;

  if (!force) {
    const cached = wordCache.get(url);
    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at.replace(" ", "T")).getTime();
      if (Number.isNaN(age) || age < CACHE_TTL_MS) {
        return {
          url,
          headword: cached.headword,
          bodyHtml: cached.body_html,
          cached: true,
          fetchedAt: cached.fetched_at,
        };
      }
    }
  }

  const html = await fetchHtml(url);
  const extracted = extractBritannica(html);
  if (!extracted) {
    const needLogin = /ログイン|会員|login/i.test(html) && !/article/.test(html);
    throw new Error(
      needLogin
        ? "ブリタニカの本文が取得できませんでした。ログイン(Cookie)が必要な可能性があります。"
        : "このページにブリタニカ国際大百科事典の項目が見つかりませんでした。"
    );
  }

  wordCache.set(url, extracted.headword, extracted.bodyHtml);
  return {
    url,
    headword: extracted.headword,
    bodyHtml: extracted.bodyHtml,
    cached: false,
    fetchedAt: new Date().toISOString(),
  };
}

// ログイン(Cookie)が有効かどうかの簡易チェック
export async function probeAuth(): Promise<{ ok: boolean; status: number; loginRequired: boolean }> {
  const res = await paced(() =>
    fetch(`${BASE}/dictionary/britannica/`, { headers: authHeaders(), redirect: "follow" })
  );
  const text = await res.text();
  const loginRequired = /ログインしてください|会員登録|ログインが必要/.test(text);
  return { ok: res.ok, status: res.status, loginRequired };
}
