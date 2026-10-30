import type { AgAiHistoryStore, AgAiThread, AgAiHistoryStoreEventListener } from "ag-studio";
import { SAVED_THREAD } from "./saved";
import { LADDER_THREAD } from "./saved-ladder";

export const SAVED_THREAD_ID = "saved-money-by-who-decided";
export const LADDER_THREAD_ID = "saved-ladder-filter-open";

/** Shown under the recorded ladder run, marked as added afterwards: the cases it named have since been filed. */
export const LADDER_NOTE = {
  id: "note-after-recording",
  role: "assistant",
  parts: [
    {
      type: "text",
      text: "_Note added after this recording, not part of it:_ PP-R-DIX-10194390 and PP-R-VXA-10194375 were filed later that morning, so the desk beside this run has moved on. Opening the recording calls no model, and its filter now finds neither still on your move.",
    },
  ],
  createdAt: 6,
} as unknown as AgAiThread["messages"][number];

/**
 * The analyst's conversations for this visit, kept in memory, opening with the two saved exchanges: the chart
 * built on the Money page (./saved.ts) and the ladder cross-filtered and a case opened (./saved-ladder.ts). Studio
 * opens the newest thread when its panel first shows, which is the Money one; the other is a click away in the
 * panel's conversation list. `onOpen` hears when a saved thread is first opened, so the page can show what that
 * run did (the ladder's filter) without calling a model.
 */
export function seededHistory(onOpen?: (threadId: string) => void): AgAiHistoryStore {
  const threads = new Map<string, AgAiThread>();
  threads.set(LADDER_THREAD_ID, {
    summary: { threadId: LADDER_THREAD_ID, agentId: "exhibit-analyst", title: LADDER_THREAD.title, updatedAt: 0 },
    // The recording as it came back, then a note that is not part of it: the desk has moved on since.
    messages: [...LADDER_THREAD.messages, LADDER_NOTE],
  });
  if (SAVED_THREAD) {
    threads.set(SAVED_THREAD_ID, {
      summary: { threadId: SAVED_THREAD_ID, agentId: "exhibit-analyst", title: SAVED_THREAD.title, updatedAt: 1 },
      messages: SAVED_THREAD.messages,
    });
  }
  const saved = new Set(threads.keys());
  const listeners = new Set<AgAiHistoryStoreEventListener>();
  const store: AgAiHistoryStore = {
    listThreads: async () => [...threads.values()].map((t) => t.summary).sort((a, b) => a.updatedAt - b.updatedAt),
    loadThread: async (id) => {
      const t = threads.get(id);
      if (t && saved.has(id)) onOpen?.(id);
      return t;
    },
    saveThread: async (thread) => {
      threads.set(thread.summary.threadId, thread);
    },
    deleteThread: async (id) => {
      threads.delete(id);
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  // Development only: lets a recording script read a finished run back out, to refresh the saved exchanges.
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    (window as unknown as { __exhibitThreads?: Map<string, AgAiThread> }).__exhibitThreads = threads;
  }
  return store;
}
