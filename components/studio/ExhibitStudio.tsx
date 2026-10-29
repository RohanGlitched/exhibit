"use client";

import { AgStudioAiModule, enableStudioDevValidations, type AgReportState, type AgStudioApi, type AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { exhibitAi } from "./ai";
import { studioData, type AnalyticsPayload } from "./data";
import { initialReport, pageRows, PAGES } from "./report";
import { exhibitStudioTheme } from "./theme";
import { exhibitWidgets, type ExhibitRegistry } from "./widgets/definitions";
import styles from "./studio.module.css";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

// Production always reads this deployment's own desk. In development, NEXT_PUBLIC_ANALYTICS_SOURCE (an origin
// such as https://exhibit-desk.vercel.app) points the page at another desk through a dev-only rewrite in
// next.config.ts, since a dev server's own desk holds only a few local briefs.
const SOURCE = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ANALYTICS_SOURCE ? "/api/analytics-remote" : "/api/analytics";
const LICENSE = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY || undefined;
const REFRESH_MS = 60_000;

// Studio's canvas: 18 px rows plus the page's own padding. In read mode the frame grows to the whole page,
// plus a strip of empty backing sheet along the bottom, so nothing scrolls inside the frame and Studio's
// evaluation notice (shown in the bottom corner for a few seconds when no licence key is set) lands on
// blank paper, never on a figure.
const ROW_PX = 18;
const CANVAS_PAD_PX = 30;
const FOOT_STRIP_PX = 120;

const LOCALE = {
  panelTitleAi: "Exhibit analyst",
  aiMessageInputPlaceholder: "Ask about the desk, or ask for a widget",
  aiNewChat: "New conversation",
};

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; payload: AnalyticsPayload };

async function fetchDesk(signal?: AbortSignal): Promise<AnalyticsPayload> {
  const res = await fetch(SOURCE, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`The desk answered ${res.status}.`);
  const body = (await res.json()) as AnalyticsPayload;
  if (!Array.isArray(body.cases) || !Array.isArray(body.sentences)) throw new Error("The desk sent something unexpected.");
  return body;
}

/**
 * The desk in AG Studio: Exhibit's report (three pages of built-in and custom widgets), themed as paperwork,
 * with the Exhibit analyst in Studio's chat panel. Binder tabs above the canvas turn the pages; a switch
 * moves between reading the report and working on it with the analyst (Studio's edit mode).
 */
export default function ExhibitStudio() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const latest = useRef<AnalyticsPayload | null>(null);
  const read = useCallback(() => latest.current, []);

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async (first: boolean) => {
      try {
        const payload = await fetchDesk(ctrl.signal);
        // Only hand Studio new data when the desk has moved on, so widgets don't refetch for nothing.
        if (latest.current?.at !== payload.at) {
          latest.current = payload;
          setLoad({ state: "ready", payload });
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (first) setLoad({ state: "error", message: err instanceof Error ? err.message : "The desk couldn't be read." });
      }
      timer = setTimeout(() => pull(false), REFRESH_MS);
    };
    pull(true);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, []);

  if (load.state === "loading") return <Placeholder>Reading the desk from PayPal…</Placeholder>;
  if (load.state === "error")
    return (
      <Placeholder>
        The desk couldn&apos;t be read just now ({load.message}). <button onClick={() => location.reload()}>Try again</button>
      </Placeholder>
    );
  return <Report payload={load.payload} read={read} />;
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className={styles.frame}>
      <div className={styles.placeholder}>
        <p>{children}</p>
      </div>
    </div>
  );
}

function Report({ payload, read }: { payload: AnalyticsPayload; read: () => AnalyticsPayload | null }) {
  // Studio reads initialState and ai once, when it is created.
  const [narrow] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [initialState] = useState<AgReportState<ExhibitRegistry>>(() => initialReport(narrow, payload));
  const ai = useMemo(() => exhibitAi(read), [read]);
  const data = useMemo(() => studioData(payload), [payload]);
  const layout = useMemo(() => (narrow ? { minWidth: 320 } : { minWidth: 640 }), [narrow]);
  // On a phone the canvas gets the whole width: no filters rail in read mode.
  const panels = useMemo(() => (narrow ? { view: { left: [], right: [] } } : undefined), [narrow]);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [page, setPage] = useState(initialState.selectedPageId);
  const [rows, setRows] = useState(() => pageRows(initialState.pages.find((p) => p.id === initialState.selectedPageId)));
  const api = useRef<AgStudioApi<ExhibitRegistry> | null>(null);

  const turn = (id: string) => {
    const a = api.current;
    if (!a) return;
    a.setState({ ...a.getState(), selectedPageId: id });
  };

  // Editing opens with the analyst's panel out, since that is what the switch promises, and Studio's compose
  // and data panels folded so the canvas keeps its width; both open from their rails.
  const edit = () => {
    setMode("edit");
    const a = api.current;
    if (!a) return;
    const s = a.getState();
    a.setState({ ...s, panels: { ...s.panels, ai: { ...s.panels?.ai, collapsed: false }, edit: { collapsed: true }, data: { collapsed: true } } });
  };

  const decided = payload.cases.filter((c) => c.outcome !== "Pending").length;
  const height = mode === "view" ? `${rows * ROW_PX + CANVAS_PAD_PX + FOOT_STRIP_PX}px` : undefined;

  return (
    <div className={styles.frame}>
      <div className={styles.bar}>
        <div className={styles.tabs} role="tablist" aria-label="Report pages">
          {PAGES.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={page === p.id} className={styles.tab} onClick={() => turn(p.id)} title={p.note}>
              {p.title}
            </button>
          ))}
        </div>
        <div className={styles.modes} role="group" aria-label="Mode">
          <button type="button" aria-pressed={mode === "view"} onClick={() => setMode("view")}>
            Read
          </button>
          <button type="button" aria-pressed={mode === "edit"} onClick={edit}>
            Edit with the analyst
          </button>
        </div>
      </div>
      <div className={styles.studio} data-mode={mode} style={height ? { height } : undefined}>
        <AgStudioProvider licenseKey={LICENSE} modules={[AgStudioAiModule]}>
          <AgStudio<ExhibitRegistry>
            style={{ width: "100%", height: "100%" }}
            theme={exhibitStudioTheme}
            widgets={exhibitWidgets as never}
            data={data}
            initialState={initialState}
            mode={mode}
            ai={ai}
            layout={layout}
            panels={panels}
            localeText={LOCALE}
            onApiReady={(e) => {
              api.current = e.api as unknown as AgStudioApi<ExhibitRegistry>;
              // Development only: lets a recording script read the report back after an analyst run.
              if (process.env.NODE_ENV !== "production") (window as unknown as { __exhibitState?: () => unknown }).__exhibitState = () => api.current?.getState();
            }}
            onStateUpdated={(e) => {
              setPage(e.state.selectedPageId);
              setRows(pageRows(e.state.pages.find((p) => p.id === e.state.selectedPageId)));
            }}
          />
        </AgStudioProvider>
      </div>
      <p className={styles.foot}>
        {payload.cases.length} cases and {payload.sentences.length} checked sentences, {decided} decided by PayPal. Read{" "}
        {new Date(payload.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC, refreshed every minute. Double-click a case id or a
        ladder rung to open the case.
      </p>
    </div>
  );
}
