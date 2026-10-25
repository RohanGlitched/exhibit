/** The report's pages, as binder tabs. Shared by the client report and the analyst's server-side instructions. */
export const PAGES = [
  { id: "deadlines", title: "Deadlines", note: "What PayPal is waiting on, soonest first" },
  { id: "money", title: "Money", note: "Kept, refunded, lost and still at stake" },
  { id: "checker", title: "The checker", note: "What stood on a record, and what was struck" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

export const isPageId = (v: unknown): v is PageId => PAGES.some((p) => p.id === v);
