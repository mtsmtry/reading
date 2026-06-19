import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Bookmark } from "../types";

export function BookmarksPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: bookmarks = [], isLoading } = useQuery({
    queryKey: ["bookmarks"],
    queryFn: api.bookmarks,
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteBookmark(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmarks"] }),
  });

  const update = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) => api.updateBookmark(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmarks"] }),
  });

  return (
    <aside className="bookmarks-panel">
      <header className="bm-head">
        <h2>しおり（{bookmarks.length}）</h2>
        <button className="x" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="bm-list">
        {isLoading && <p className="muted">読み込み中…</p>}
        {!isLoading && bookmarks.length === 0 && (
          <p className="muted">まだしおりはありません。カードの ☆ で追加できます。</p>
        )}
        {bookmarks.map((b) => (
          <BookmarkRow
            key={b.id}
            bm={b}
            onDelete={() => del.mutate(b.id)}
            onSaveNote={(note) => update.mutate({ id: b.id, note })}
          />
        ))}
      </div>
    </aside>
  );
}

function BookmarkRow({
  bm,
  onDelete,
  onSaveNote,
}: {
  bm: Bookmark;
  onDelete: () => void;
  onSaveNote: (note: string) => void;
}) {
  const [note, setNote] = useState(bm.note);
  const dirty = note !== bm.note;
  return (
    <div className="bm-item">
      <div className="bm-item-head">
        <a href={bm.url} target="_blank" rel="noopener noreferrer" className="bm-term">
          {bm.term}
        </a>
        {bm.page != null && <span className="badge">p.{bm.page}</span>}
        <button className="x small" onClick={onDelete} title="削除">
          ×
        </button>
      </div>
      {bm.excerpt && <p className="bm-excerpt">{bm.excerpt}…</p>}
      <div className="bm-note">
        <textarea
          rows={2}
          placeholder="メモ…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {dirty && (
          <button className="link" onClick={() => onSaveNote(note)}>
            メモを保存
          </button>
        )}
      </div>
      <time className="bm-time">{bm.created_at}</time>
    </div>
  );
}
