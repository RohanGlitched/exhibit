import type { AgentStep, Responsibility } from "./types";

/** What the case page shows about an agent-placed order. Plain JSON; safe for client components. */
export interface AgentView {
  request: string;
  item: string;
  limit: string;
  cardholder: string;
  agentName: string;
  verdict: Responsibility;
  checks: { label: string; ok: boolean; detail: string }[];
  legacy: boolean; // opened before the live buyer agent: mandates rebuilt with stand-in keys
  script?: string[]; // the story's scripted log, for those cases
  run?: {
    engine: "model" | "scripted";
    model?: string;
    fallback?: string;
    modelSteps?: AgentStep[];
    modelTold?: string;
    steps: AgentStep[];
    told?: string;
    injection: boolean;
    digest: string;
    orderId?: string;
    ms: number;
    intentKid: string;
    cartKid: string;
  };
}
