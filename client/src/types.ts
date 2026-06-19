export type ListItem = {
  term: string;
  href: string;
};

export type ListResult = {
  page: number;
  items: ListItem[];
  pageNumbers: number[];
  hasPrev: boolean;
  hasNext: boolean;
  rangeLabel: string | null;
};

export type WordResult = {
  url: string;
  headword: string;
  bodyHtml: string;
  cached: boolean;
  fetchedAt: string;
};

export type Bookmark = {
  id: number;
  term: string;
  url: string;
  page: number | null;
  note: string;
  excerpt: string;
  created_at: string;
};

export type AuthStatus = {
  hasCookie: boolean;
  cookiePreview: string | null;
};

export type ProgressLast = {
  page: number;
  item_index: number;
  url: string;
  term: string;
  updated_at: string;
} | null;

export type ProgressState = {
  last: ProgressLast;
  pages: Record<string, number>;
};
