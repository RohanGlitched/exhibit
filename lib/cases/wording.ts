import type { Exhibit } from "./types";

/**
 * A second pass for the sentences the figure checker keeps as unverified (nothing in them it can match): the
 * sentence's own words against the text of the exhibits it cites, and nothing else. A sentence passes when at
 * least WORDING_SHARE of its content words (stop words and the parties' role words left out, endings trimmed)
 * appear in what it cites. It reads words, not meaning: "the listing warns the glaze pools green" passes on a
 * listing that says so, and would pass on one that says the opposite in the same words. Safe to import anywhere.
 */

export const WORDING_SHARE = 0.6;

const STOP = new Set(
  (
    "the a an and or but of to in on at by for with from as is are was were be been being has have had do does did not no nor " +
    "this that these those it its it's they them their there here then than so such very also only just any all each every " +
    "because still already yet while though although which who whom whose what when where why how into onto over under after before about above below up down out off again " +
    "we our us ours you your yours he she his her him i me my mine can could would should will may might must shall " +
    "buyer buyer's seller seller's customer cardholder cardholder's shop store merchant exhibit exhibits paypal case dispute chargeback"
  ).split(" "),
);

/** "delivered" and "delivery" both read as "deliver"; "bowls" as "bowl". Crude on purpose: it only has to be consistent. */
export const stem = (w: string) =>
  w
    .toLowerCase()
    .replace(/['’]s$/, "")
    .replace(/(?:ations?|ments?|ings?|ies|ied|ed|es|ly|y|s)$/, "")
    .replace(/(.)\1$/, "$1");

export const contentWords = (text: string) =>
  [...new Set((text.toLowerCase().replace(/[’]/g, "'").match(/[a-z][a-z'-]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)))];

export interface WordingCheck {
  matched: boolean;
  share: number;
  words: number;
  missing: string[];
}

export function wordingMatch(text: string, cited: Exhibit[], textOf: (e: Exhibit) => string): WordingCheck {
  const words = contentWords(text);
  if (!words.length) return { matched: false, share: 0, words: 0, missing: [] };
  const hay = new Set(contentWords(cited.map(textOf).join("\n")).map(stem));
  const missing = words.filter((w) => !hay.has(stem(w)));
  const share = (words.length - missing.length) / words.length;
  return { matched: share >= WORDING_SHARE, share: Number(share.toFixed(2)), words: words.length, missing };
}
