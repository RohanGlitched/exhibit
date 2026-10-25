import type { AgAiHistoryStore, AgAiThread, AgAiHistoryStoreEventListener } from "ag-studio";
import { SAVED_THREAD } from "./saved";

export const SAVED_THREAD_ID = "saved-kept-vs-refunded";

/**
 * The analyst's conversations for this visit, kept in memory, opening with the one saved exchange
 * (./saved.ts). Studio opens the newest thread when its panel first shows, so a reader sees a finished
 * request, the tools it ran and the widget it built, and can carry on from there or start a new one.
 */
export function seededHistory(): AgAiHistoryStore {
  const threads = new Map<string, AgAiThread>();
  if (SAVED_THREAD) {
    threads.set(SAVED_THREAD_ID, {
      summary: { threadId: SAVED_THREAD_ID, agentId: "exhibit-analyst", title: SAVED_THREAD.title, updatedAt: 0 },
      messages: SAVED_THREAD.messages,
    });
  }
  const listeners = new Set<AgAiHistoryStoreEventListener>();
  const store: AgAiHistoryStore = {
    listThreads: async () => [...threads.values()].map((t) => t.summary).sort((a, b) => a.updatedAt - b.updatedAt),
    loadThread: async (id) => threads.get(id),
    saveThread: async (thread) => {
      threads.set(thread.summary.threadId, thread);
    },
    deleteThread: async (id) => {
      threads.delete(id);
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  // Development only: lets a recording script read a finished run back out, to refresh the saved exchange.
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    (window as unknown as { __exhibitThreads?: Map<string, AgAiThread> }).__exhibitThreads = threads;
  }
  return store;
}
