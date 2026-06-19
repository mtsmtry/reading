import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Bookmark, ListItem, ProgressState } from "./types";
import { ItemCard } from "./components/ItemCard";
import { AuthPanel } from "./components/AuthPanel";
import { BookmarksPanel } from "./components/BookmarksPanel";

function pageFromPath(): number | null {
  const m = window.location.pathname.match(/^\/(\d+)\/?$/);
  return m ? Math.max(1, Number(m[1])) : null;
}

const KOTOBANK_BASE = "https://kotobank.jp/dictionary/britannica/";
const kotobankPageUrl = (p: number) => (p <= 1 ? KOTOBANK_BASE : `${KOTOBANK_BASE}${p}/`);

export default function App() {
  const qc = useQueryClient();
  const [page, setPage] = useState(() => pageFromPath() ?? 1);
  const hadUrlPageRef = useRef(pageFromPath() != null);
  const [autoLoad, setAutoLoad] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [filter, setFilter] = useState("");

  const { data: list, isLoading, isError, error } = useQuery({
    queryKey: ["list", page],
    queryFn: () => api.list(page),
  });

  const { data: bookmarks = [] } = useQuery({
    queryKey: ["bookmarks"],
    queryFn: api.bookmarks,
  });
  const bookmarkedUrls = useMemo(
    () => new Set(bookmarks.map((b: Bookmark) => b.url)),
    [bookmarks]
  );

  const { data: state, isFetched: progressLoaded } = useQuery<ProgressState>({
    queryKey: ["progress"],
    queryFn: api.getProgress,
    staleTime: Infinity,
  });
  const last = state?.last ?? null;
  // handleRead から最新の進捗を同期的に参照するための ref
  const stateRef = useRef<ProgressState>({ last: null, pages: {} });
  useEffect(() => {
    if (state) stateRef.current = state;
  }, [state]);

  const goPage = (p: number) => {
    const next = Math.max(1, p);
    setPage(next);
    if (pageFromPath() !== next) window.history.pushState(null, "", `/${next}`);
    window.scrollTo({ top: 0 });
  };

  /* ---- URL(/<page>)との同期 ---- */
  useEffect(() => {
    if (pageFromPath() == null) window.history.replaceState(null, "", `/${page}`);
    const onPop = () => setPage(pageFromPath() ?? 1);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- 前回位置から復帰（URLでページ指定がない初回のみ） ---- */
  const restoredPageRef = useRef(false);
  useEffect(() => {
    if (restoredPageRef.current) return;
    if (hadUrlPageRef.current) {
      restoredPageRef.current = true;
    } else if (last?.page) {
      restoredPageRef.current = true;
      goPage(last.page);
    } else if (state) {
      restoredPageRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* ---- 復帰: 保存ページの一覧が出たら一度だけ前回項目までスクロール ---- */
  const autoScrolledRef = useRef(false);
  useEffect(() => {
    if (autoScrolledRef.current) return;
    if (list && last && last.page === page && list.items.some((i) => i.href === last.url)) {
      autoScrolledRef.current = true;
      window.setTimeout(() => scrollToUrl(last.url), 350);
    }
  }, [list, last, page]);

  /* ---- 進捗の保存（読んだ位置を debounce 保存） ---- */
  const saveProgress = useMutation({
    mutationFn: api.saveProgress,
    onSuccess: (s) => qc.setQueryData(["progress"], s),
  });
  const saveTimer = useRef<number | undefined>(undefined);

  // 既読判定はページごとの到達点(ハイウォーターマーク)。
  //  - 同一ページ内では index 以下を既読扱い（スクロール到達点まで連続）
  //  - ページをまたいだ移動は制限せず、各ページが独立に到達点を持つ
  function handleRead(index: number, item: ListItem) {
    if (!progressLoaded) return; // サーバーの進捗が読み込まれるまで待つ
    const cur = stateRef.current;
    const key = String(page);
    const curMax = cur.pages[key] ?? -1;
    if (index <= curMax) return; // すでに既読範囲内（後退しない）

    const next: ProgressState = {
      last: { page, item_index: index, url: item.href, term: item.term, updated_at: new Date().toISOString() },
      pages: { ...cur.pages, [key]: index },
    };
    stateRef.current = next;
    qc.setQueryData(["progress"], next); // 楽観的更新（即時に既読表示へ反映）

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveProgress.mutate({ page, itemIndex: index, url: item.href, term: item.term });
    }, 800);
  }

  const addBm = useMutation({
    mutationFn: (v: { term: string; url: string; excerpt: string }) =>
      api.addBookmark({ term: v.term, url: v.url, page, excerpt: v.excerpt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmarks"] }),
  });
  const removeBm = useMutation({
    mutationFn: (url: string) => api.deleteBookmarkByUrl(url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmarks"] }),
  });

  function toggleBookmark(item: ListItem, excerpt: string) {
    if (bookmarkedUrls.has(item.href)) removeBm.mutate(item.href);
    else addBm.mutate({ term: item.term, url: item.href, excerpt });
  }

  function scrollToUrl(url: string) {
    const el = document.querySelector(`[data-url="${CSS.escape(url)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const filteredItems = useMemo(() => {
    if (!list) return [];
    const q = filter.trim();
    if (!q) return list.items;
    return list.items.filter((i) => i.term.includes(q));
  }, [list, filter]);

  // 現在ページの既読到達点（このindex以下を既読扱い）。ページごとに独立。
  const furthest = state?.pages[String(page)] ?? -1;

  const readCount = list && furthest >= 0 ? Math.min(list.items.length, furthest + 1) : 0;

  const showResumeBanner =
    last && last.page === page && list?.items.some((i) => i.href === last.url);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>
            ブリタニカ国際大百科事典{" "}
            <span className="sub">小項目事典 ローカルビューア</span>
          </h1>
        </div>
        <div className="top-actions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoLoad}
              onChange={(e) => setAutoLoad(e.target.checked)}
            />
            本文を自動表示
          </label>
          <button onClick={() => setShowBookmarks((v) => !v)}>
            しおり（{bookmarks.length}）
          </button>
          <a
            className="btn-link"
            href={kotobankPageUrl(page)}
            target="_blank"
            rel="noopener noreferrer"
            title={`p.${page} をコトバンクで開く`}
          >
            コトバンクで開く ↗
          </a>
          <button onClick={() => setShowAuth(true)}>ログイン設定</button>
        </div>
      </header>

      {last && (
        <div className="resume-bar">
          <span>
            前回の続き: <strong>{last.term}</strong>（p.{last.page}）まで読了
          </span>
          {showResumeBanner ? (
            <button className="primary" onClick={() => scrollToUrl(last.url)}>
              ここから再開
            </button>
          ) : (
            <button className="primary" onClick={() => goPage(last.page)}>
              p.{last.page} を開く
            </button>
          )}
        </div>
      )}

      <Pager list={list} page={page} onGo={goPage} />

      <div className="toolbar">
        <input
          className="filter"
          placeholder="このページ内を絞り込み（項目名）"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {list && (
          <span className="count">
            {filteredItems.length} / {list.items.length} 件
            {readCount > 0 ? `・既読 ${readCount}` : ""}
            {list.rangeLabel ? `（${list.rangeLabel}）` : ""}
          </span>
        )}
      </div>

      <main className="content">
        {isLoading && <p className="muted center">一覧を読み込み中…</p>}
        {isError && (
          <p className="error center">一覧の取得に失敗: {(error as Error).message}</p>
        )}

        <div className="cards">
          {filteredItems.map((item) => {
            const realIndex = list ? list.items.indexOf(item) : -1;
            return (
              <ItemCard
                key={item.href}
                item={item}
                index={realIndex}
                enabled={autoLoad}
                bookmarked={bookmarkedUrls.has(item.href)}
                read={realIndex >= 0 && realIndex <= furthest}
                onToggleBookmark={toggleBookmark}
                onRead={handleRead}
              />
            );
          })}
        </div>
      </main>

      <Pager list={list} page={page} onGo={goPage} />

      <footer className="footer">
        <p>
          本文の著作権は Britannica Japan Co., Ltd. および kotobank に帰属します。本ツールは
          個人のローカル閲覧専用です。
        </p>
      </footer>

      {showAuth && <AuthPanel onClose={() => setShowAuth(false)} />}
      {showBookmarks && <BookmarksPanel onClose={() => setShowBookmarks(false)} />}
    </div>
  );
}

function Pager({
  list,
  page,
  onGo,
}: {
  list: { pageNumbers: number[]; hasPrev: boolean; hasNext: boolean } | undefined;
  page: number;
  onGo: (p: number) => void;
}) {
  const [input, setInput] = useState(String(page));
  useEffect(() => {
    setInput(String(page));
  }, [page]);

  const submit = () => {
    const v = parseInt(input.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(v) && v >= 1) onGo(v);
    else setInput(String(page));
  };

  return (
    <nav className="pager">
      <button disabled={!list?.hasPrev} onClick={() => onGo(page - 1)}>
        ‹ 前へ
      </button>
      <div className="pager-nums">
        {list?.pageNumbers.map((n) => (
          <button key={n} className={n === page ? "current" : ""} onClick={() => onGo(n)}>
            {n}
          </button>
        ))}
      </div>
      <form
        className="jump"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        ページ:
        <input
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="ページ番号"
        />
        <button type="submit">確定</button>
      </form>
      <button disabled={!list?.hasNext} onClick={() => onGo(page + 1)}>
        次へ ›
      </button>
    </nav>
  );
}
