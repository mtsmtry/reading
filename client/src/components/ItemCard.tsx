import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ListItem } from "../types";

type Props = {
  item: ListItem;
  index: number;
  enabled: boolean;
  bookmarked: boolean;
  read: boolean;
  onToggleBookmark: (item: ListItem, excerpt: string) => void;
  onRead: (index: number, item: ListItem) => void;
};

// 「読んだ」と判定するまでの滞在時間（カードが十分見えている状態が続いた時間）
const DWELL_MS = 2500;
const VISIBLE_RATIO = 0.55;

export function ItemCard({
  item,
  index,
  enabled,
  bookmarked,
  read,
  onToggleBookmark,
  onRead,
}: Props) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["word", item.href],
    queryFn: () => api.word(item.href),
    enabled,
    staleTime: Infinity,
  });

  const ref = useRef<HTMLElement | null>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
          if (timer == null) {
            timer = window.setTimeout(() => {
              onReadRef.current(index, item);
              timer = undefined;
            }, DWELL_MS);
          }
        } else if (timer != null) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: [0, VISIBLE_RATIO, 1] }
    );
    observer.observe(el);
    return () => {
      if (timer != null) clearTimeout(timer);
      observer.disconnect();
    };
  }, [index, item]);

  const bodyText = data
    ? new DOMParser().parseFromString(data.bodyHtml, "text/html").body.textContent?.trim() ?? ""
    : "";
  const excerpt = bodyText.slice(0, 140);

  // 参照・曖昧さ回避のみの項目は表示しない
  //  例:「『〜』のページをご覧ください。」「次の項目を参照 | 〜 | 〜」
  const isRedirectStub =
    /のページをご覧ください/.test(bodyText) ||
    /次の項目を参照/.test(bodyText) ||
    /参照\s*$/.test(bodyText);
  if (data && isRedirectStub) return null;

  return (
    <article
      ref={ref}
      data-url={item.href}
      className={read ? "card read" : "card"}
    >
      <header className="card-head">
        <div className="card-title">
          <h3>
            {read && <span className="read-dot" title="既読">✓</span>}
            {item.term}
          </h3>
          {data?.headword && data.headword !== item.term && (
            <span className="headword">{data.headword}</span>
          )}
        </div>
        <div className="card-actions">
          <button
            className="icon"
            title="最新に再取得"
            disabled={isFetching}
            onClick={() => api.word(item.href, true).then(() => refetch())}
          >
            ↻
          </button>
          <button
            className={bookmarked ? "bm bm-on" : "bm"}
            title={bookmarked ? "しおりを外す" : "しおりを付ける"}
            onClick={() => onToggleBookmark(item, excerpt)}
          >
            {bookmarked ? "★" : "☆"}
          </button>
          <a
            className="ext"
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            title="kotobankで開く"
          >
            ↗
          </a>
        </div>
      </header>

      <div className="card-body">
        {!enabled && <p className="muted">（本文の自動読み込みはオフです）</p>}
        {enabled && isLoading && <p className="muted">読み込み中…</p>}
        {isError && (
          <p className="error">
            取得失敗: {(error as Error).message}{" "}
            <button className="link" onClick={() => refetch()}>
              再試行
            </button>
          </p>
        )}
        {data && (
          <div
            className="britannica-body"
            dangerouslySetInnerHTML={{ __html: data.bodyHtml }}
          />
        )}
      </div>
    </article>
  );
}
