/**
 * The chart palette in the order a chart hands its colours out, by series: Exhibit's inks. Apart from the
 * theme (./theme.ts) so the tests can check that each money series gets the ink the page says it does.
 */
export const INK = {
  respondent: "#2b63e8", // the seller's blue: money at stake, kept sentences
  due: "#d3242c", // due red: lost, struck
  won: "#17845a", // won green: kept by fighting
  ink: "#13203a", // plain ink: refunded
} as const;

export const PALETTE = [INK.respondent, INK.due, INK.won, INK.ink, "#f3cf3a", "#8792a8", "#1d4bc4", "#c9a400", "#7fa0f0", "#a9b4c6"];
