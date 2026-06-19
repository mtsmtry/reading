import type { AuthStatus, Bookmark, ListResult, ProgressState, WordResult } from "./types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* --- 同時リクエスト数を制限する簡易キュー（kotobankへの負荷軽減） --- */
class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = () => {
        this.active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            const next = this.queue.shift();
            if (next) next();
          });
      };
      if (this.active < this.max) task();
      else this.queue.push(task);
    });
  }
}
const wordLimiter = new Limiter(4);

export const api = {
  list: (page: number) => jsonFetch<ListResult>(`/api/list/${page}`),

  word: (url: string, force = false) =>
    wordLimiter.run(() =>
      jsonFetch<WordResult>(`/api/word`, {
        method: "POST",
        body: JSON.stringify({ url, force }),
      })
    ),

  bookmarks: () => jsonFetch<Bookmark[]>(`/api/bookmarks`),

  addBookmark: (b: { term: string; url: string; page?: number | null; excerpt?: string }) =>
    jsonFetch<Bookmark>(`/api/bookmarks`, {
      method: "POST",
      body: JSON.stringify(b),
    }),

  updateBookmark: (id: number, note: string) =>
    jsonFetch<Bookmark>(`/api/bookmarks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    }),

  deleteBookmark: (id: number) =>
    jsonFetch<void>(`/api/bookmarks/${id}`, { method: "DELETE" }),

  deleteBookmarkByUrl: (url: string) =>
    jsonFetch<void>(`/api/bookmarks?url=${encodeURIComponent(url)}`, {
      method: "DELETE",
    }),

  getProgress: () => jsonFetch<ProgressState>(`/api/progress`),

  saveProgress: (p: { page: number; itemIndex: number; url: string; term: string }) =>
    jsonFetch<ProgressState>(`/api/progress`, {
      method: "PUT",
      body: JSON.stringify(p),
    }),

  auth: () => jsonFetch<AuthStatus>(`/api/auth`),

  saveCookie: (cookie: string) =>
    jsonFetch<{ ok: boolean }>(`/api/auth/cookie`, {
      method: "POST",
      body: JSON.stringify({ cookie }),
    }),

  clearCookie: () => jsonFetch<{ ok: boolean }>(`/api/auth/cookie`, { method: "DELETE" }),

  probe: () =>
    jsonFetch<{ ok: boolean; status: number; loginRequired: boolean }>(`/api/auth/probe`),

  clearCache: () => jsonFetch<{ ok: boolean }>(`/api/cache`, { method: "DELETE" }),
};
