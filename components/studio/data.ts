import type { AgDataSourcesDefinition, AgExpressionFieldDefinition, AgFieldDefinition, AgFormat } from "ag-studio";
import type { CaseFact, SentenceFact } from "@/lib/analytics";
import type { ExhibitRegistry } from "./widgets/definitions";

/** What GET /api/analytics returns (lib/analytics.ts). */
export interface AnalyticsPayload {
  cases: CaseFact[];
  sentences: SentenceFact[];
  at: string;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("en-US", { style: "unit", unit: "percent", maximumFractionDigits: 0 });
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Spec = [id: string, name: string, format: AgFormat, description: string, extra?: Partial<AgFieldDefinition>];

const fields = (specs: Spec[]): AgFieldDefinition[] => specs.map(([id, name, format, description, extra]) => ({ id, name, format, description, ...extra }));
const money = { formatOptions: { format: usd } };
const day = { formatOptions: { format: dayFmt } };

// ISO times to calendar days, which is what the data engine groups and filters dates by.
const toDay = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

const strikeRate: AgExpressionFieldDefinition = {
  id: "strikeRate",
  name: "Strike rate",
  description: "Share of the sentences Exhibit wrote that its checker struck for lack of a record.",
  format: "percentageFormat",
  isMeasure: true,
  expression: { operator: "divide", inputs: [{ id: "cases.struck", aggregation: "sum" }, { id: "cases.sentences", aggregation: "sum" }] },
};

const winRate: AgExpressionFieldDefinition = {
  id: "keptShare",
  name: "Kept share of decided money",
  description: "Money kept by fighting, as a share of every dollar PayPal has decided (kept, refunded or lost).",
  format: "percentageFormat",
  isMeasure: true,
  expression: {
    operator: "divide",
    inputs: [
      { id: "cases.kept", aggregation: "sum" },
      {
        operator: "add",
        inputs: [
          {
            operator: "add",
            inputs: [
              { id: "cases.kept", aggregation: "sum" },
              { id: "cases.refunded", aggregation: "sum" },
            ],
          },
          { id: "cases.lostAmount", aggregation: "sum" },
        ],
      },
    ],
  },
};

/** The desk as AG Studio data: one table of cases, one of the sentences in Exhibit's briefs, joined on the case id. */
export function studioData(payload: AnalyticsPayload): AgDataSourcesDefinition<ExhibitRegistry> {
  // `n` is 1 on every row, so a sum of it counts cases or sentences wherever a widget needs a count.
  const cases = payload.cases.map((c) => ({ ...c, n: 1, opened: toDay(c.opened), filed: toDay(c.filed), due: toDay(c.due) }));
  const sentences = payload.sentences.map((s) => ({
    ...s,
    n: 1,
    keptCount: s.kept === "Kept" ? 1 : 0,
    struckCount: s.kept === "Struck" ? 1 : 0,
    argued: toDay(s.argued),
    why: s.why || (s.kept === "Kept" ? "Cites a record" : "No reason given"),
  }));

  return {
    description:
      "Disputes on Halden Ceramics' PayPal sandbox account, read from PayPal's Disputes API, with the brief Exhibit wrote for each. " +
      "A buyer opens a dispute; the seller has PayPal's ten-day window to answer, or loses by default. Exhibit recommends Fight (file evidence) " +
      "or Refund (accept the claim), and writes a response where every sentence must cite a PayPal record; a checker strikes any sentence that doesn't. " +
      "All money is in USD. Each case's amount sits in exactly one of kept, refunded, lostAmount or atStake.",
    sources: [
      {
        id: "cases",
        name: "Cases",
        description: "One row per dispute on the desk.",
        data: cases,
        fields: fields([
          ["caseId", "Case", "textFormat", "PayPal's dispute id, the Bates number on every page of the case."],
          ["n", "Cases", "integerFormat", "1 on every case: sum it to count cases."],
          ["story", "What happened", "textFormat", "The buyer's story in a few words."],
          ["reason", "Reason", "textFormat", "PayPal's dispute reason."],
          ["amount", "Amount", "currencyFormat", "The disputed amount in USD.", money],
          ["stage", "Where it stands", "textFormat", "Your move (the seller must answer), Filed, PayPal reviewing, Won, Lost or Refunded."],
          ["stageKey", "Stage key", "textFormat", "Machine form of the stage.", { hide: true }],
          ["outcome", "Outcome", "textFormat", "Won, Lost, Refunded, or Pending while PayPal hasn't decided."],
          ["call", "Exhibit's call", "textFormat", "Fight (file evidence), Refund (accept the claim), or Not argued yet."],
          ["engine", "Argued by", "textFormat", "Who wrote the brief: GPT-5.6, the rules engine, or read back from what PayPal holds as filed."],
          ["odds", "Odds", "integerFormat", "The seller's chance of winning, in percent, from the brief's tally.", { formatOptions: { format: pct } }],
          ["sentences", "Sentences", "integerFormat", "Sentences in the brief."],
          ["struck", "Struck", "integerFormat", "Sentences the checker struck from the brief."],
          ["evidenceType", "What was filed", "textFormat", "The evidence filed with PayPal, or Nothing filed."],
          ["buyer", "Buyer", "textFormat", "The buyer's name."],
          ["opened", "Opened", "dateFormat", "When the buyer opened the dispute.", day],
          ["openedDay", "Opened (text)", "textFormat", "Opened date as text.", { hide: true }],
          ["filed", "Filed", "dateFormat", "When the seller's response reached PayPal.", day],
          ["due", "Due", "dateFormat", "PayPal's deadline for the seller's answer.", day],
          ["daysLeft", "Days left", "integerFormat", "Days to PayPal's deadline while it's the seller's move; blank otherwise. Two or fewer is urgent."],
          ["kept", "Kept", "currencyFormat", "Money the seller kept by fighting and winning.", money],
          ["refunded", "Refunded", "currencyFormat", "Money returned to the buyer by accepting the claim.", money],
          ["lostAmount", "Lost", "currencyFormat", "Money lost after fighting, or by not answering in time.", money],
          ["atStake", "At stake", "currencyFormat", "Money still undecided.", money],
        ]),
      },
      {
        id: "sentences",
        name: "Brief sentences",
        description: "One row per sentence Exhibit wrote in a brief, after the checker read it against the PayPal records.",
        data: sentences,
        fields: fields([
          ["caseId", "Case", "textFormat", "The dispute the sentence argues."],
          ["n", "Sentences", "integerFormat", "1 on every sentence: sum it to count sentences."],
          ["story", "What happened", "textFormat", "The buyer's story for that case.", { hide: true }],
          ["engine", "Written by", "textFormat", "GPT-5.6, the rules engine, or read back from PayPal."],
          ["kept", "Checker's verdict", "textFormat", "Kept (the sentence cites a record) or Struck."],
          ["why", "Why", "textFormat", "Why the checker struck the sentence, or that it was kept."],
          ["cites", "Records cited", "integerFormat", "How many PayPal records the sentence cites."],
          ["keptCount", "Kept sentences", "integerFormat", "1 when the checker kept the sentence: sum it to count kept sentences."],
          ["struckCount", "Struck sentences", "integerFormat", "1 when the checker struck the sentence: sum it to count struck sentences."],
          ["argued", "Argued", "dateFormat", "When the brief was written.", day],
          ["arguedDay", "Argued (text)", "textFormat", "Argued date as text.", { hide: true }],
        ]),
      },
    ],
    relationships: [
      {
        id: "sentence-case",
        source: { tableId: "sentences", fieldId: "caseId" },
        target: { tableId: "cases", fieldId: "caseId" },
        type: "many-to-one",
      },
    ],
    expressions: [strikeRate, winRate],
  };
}
