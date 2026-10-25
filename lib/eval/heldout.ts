import type { Variant } from "./variants";
import type { Scenario, Scan } from "../shop/scenarios";

/**
 * A held-out set, written and labelled without reading the model's prompt. Each variant is modelled on the
 * kind of situation sellers describe on public forums (eBay, PayPal and Etsy communities), and is labelled
 * from how PayPal Seller Protection and the card networks' chargeback rules decide such cases.
 *
 * `decidedBy` says whether a rule reading only the structured records (scans, refund, AVS/CVV, addresses,
 * order history, mandate checks) would reach the label, or whether the deciding fact sits only in free text
 * (emails, notes, listing wording, the agent's log).
 */
export interface HeldoutVariant extends Variant {
  source: string; // one-line paraphrase of the forum situation, plus URL or "forum-style, not a specific thread"
  why: string; // one line: why the label is what a careful seller should do
  decidedBy: "record" | "text";
}

const FORUM = "forum-style, not a specific thread";

const firstName = (s: Scenario) => s.buyer.name.split(" ")[0];

const cityOf = (s: Scenario) => `${s.buyer.shipTo.admin_area_2}, ${s.buyer.shipTo.admin_area_1} ${s.buyer.shipTo.postal_code}`;

const withScans = (s: Scenario, scans: Scan[]): Scenario => ({
  ...s,
  carrier: { ...(s.carrier ?? { code: "USPS", name: "USPS", number: "9405511206213859470073", service: "Ground Advantage", scans: [] }), scans },
});

/** The ship-to street line with the first two digits of the street number swapped, as a hand-typed label might read. */
const mistyped = (line: string) => line.replace(/^(\d)(\d)/, "$2$1");

export const HELDOUT: HeldoutVariant[] = [
  /* ───────────── "It never arrived", carrier says delivered ───────────── */
  {
    id: "heldout-delivered-returned-to-sender",
    story: "delivered",
    change: "Delivery was attempted, the parcel was returned, and the final \"Delivered\" scan is at the shop's own address.",
    label: "accept",
    source: `Seller reads "Delivered" on the tracking and assumes the buyer has it, but the parcel was returned to sender after a failed attempt; ${FORUM}.`,
    why: "The only delivery scan is to the seller's own ZIP, so there is no proof of delivery to the buyer and the buyer never got the item.",
    decidedBy: "record",
    apply: (s) => ({
      ...withScans(s, [
        { day: 1, hour: 18, status: "Accepted", place: "Portland, OR 97214" },
        { day: 2, hour: 23, status: "In transit", place: "Sacramento, CA network distribution center" },
        { day: 4, hour: 12, status: "Attempted", place: cityOf(s), detail: "Unable to deliver" },
        { day: 6, hour: 8, status: "In transit", place: "Sacramento, CA network distribution center", detail: "Return to sender processed" },
        { day: 9, hour: 11, status: "Delivered", place: "Portland, OR 97214", detail: "Delivered to sender" },
      ]),
      inbox: [s.inbox[0], { day: 9, hour: 15, from: "shop", text: `Hi ${firstName(s)}, the tracking shows it as delivered. Let me look into it and get back to you.` }],
    }),
  },
  {
    id: "heldout-delivered-label-typo",
    story: "delivered",
    change: "The shop typed the street number wrong on the label; it was signed for by a stranger at that other address.",
    label: "accept",
    source: `Seller hand-wrote or retyped the label and swapped digits in the house number; the carrier delivered to the wrong building in the same ZIP; ${FORUM}.`,
    why: "Seller Protection and a Visa 13.1 rebuttal need delivery to the address on the transaction, and the seller's own label shows it went elsewhere.",
    decidedBy: "text",
    apply: (s) => {
      const right = s.buyer.shipTo.address_line_1;
      const wrong = mistyped(right);
      return {
        ...withScans(s, [
          { day: 1, hour: 16, status: "Label created", place: "Portland, OR 97214" },
          { day: 1, hour: 18, status: "Accepted", place: "Portland, OR 97214" },
          { day: 2, hour: 23, status: "In transit", place: "Sacramento, CA network distribution center" },
          { day: 4, hour: 7, status: "Out for delivery", place: cityOf(s) },
          { day: 4, hour: 13, status: "Delivered, signed", place: cityOf(s), detail: "Signed for by M ALVARADO" },
        ]),
        inbox: [
          s.inbox[0],
          { day: 9, hour: 15, from: "shop", text: `Hi ${firstName(s)}, USPS shows it delivered and signed for last week. Could you check with your neighbours?` },
          { day: 10, hour: 8, from: "buyer", text: "I asked around. Nobody here is called Alvarado and nobody in my building signed for anything." },
        ],
        notes: [`The studio's copy of the shipping label reads "${wrong}, ${cityOf(s)}". The order's ship-to address is "${right}". The label was typed by hand.`],
      };
    },
  },
  {
    id: "heldout-delivered-moved-away",
    story: "delivered",
    change: "The buyer says they moved out before the order and forgot to update the address; it was signed for at the address on the order.",
    label: "fight",
    source:
      "Seller shipped to the checkout address, USPS shows it delivered there, and the buyer opened a not-received case after forgetting to update their address; https://community.ebay.com/t5/Selling/Buyer-filed-item-not-received-case-after-they-realized-their/m-p/34072685",
    why: "Signed delivery to the exact address given with the payment is proof of delivery under Seller Protection and a 13.1 rebuttal; the wrong address was the buyer's error.",
    decidedBy: "record",
    apply: (s) => {
      const street = s.buyer.shipTo.address_line_1.split(",")[0];
      return {
        ...withScans(s, [
          { day: 1, hour: 16, status: "Label created", place: "Portland, OR 97214" },
          { day: 1, hour: 18, status: "Accepted", place: "Portland, OR 97214" },
          { day: 2, hour: 23, status: "In transit", place: "Sacramento, CA network distribution center" },
          { day: 4, hour: 7, status: "Out for delivery", place: cityOf(s) },
          { day: 4, hour: 13, status: "Delivered, signed", place: cityOf(s), detail: "Signed for by FRONT DESK" },
        ]),
        inbox: [
          { day: 9, hour: 10, from: "buyer", text: `Hi, my order still hasn't come. I moved out of the ${street} place at the start of the month and I think I forgot to change it at checkout. Can you check?` },
          { day: 9, hour: 15, from: "shop", text: `Hi ${firstName(s)}, USPS shows it delivered and signed for at the front desk of ${s.buyer.shipTo.address_line_1}, the address on the order. The building may still have it.` },
        ],
      };
    },
  },

  /* ───────────── Small order shipped without tracking ───────────── */
  {
    id: "heldout-untracked-positive-review",
    story: "untracked",
    change: "No tracking, but the buyer left a 5-star review for this order on day 7 saying the vase was on their windowsill.",
    label: "fight",
    source: `Seller says a buyer left a glowing review and weeks later told the payment provider the item never arrived; ${FORUM}.`,
    why: "Mastercard 4855 can be rebutted with documentation that the cardholder received the goods, and the buyer's own order-linked review is that evidence even without tracking.",
    decidedBy: "text",
    apply: (s) => ({
      ...s,
      notes: [
        ...s.notes,
        'The buyer left a 5-star review on the shop\'s site on day 7, linked to this order: "Lovely little vase, sits perfectly on my windowsill."',
      ],
    }),
  },
  {
    id: "heldout-untracked-proof-of-postage",
    story: "untracked",
    change: "No tracking; the shop has a dated post office receipt and certificate of mailing, and replied to the buyer citing it.",
    label: "accept",
    source: `Seller has a post office receipt but no tracking, and asks whether that is enough to win a not-received claim; ${FORUM}.`,
    why: "Proof of postage shows it was sent, not that it arrived; without a delivery record the seller can't meet the not-received burden.",
    decidedBy: "record",
    apply: (s) => ({
      ...s,
      inbox: [
        ...s.inbox,
        { day: 21, hour: 10, from: "shop", text: `Hi ${firstName(s)}, sorry for the slow reply. It went out the day after you ordered; I have the post office's certificate of mailing. It should turn up.` },
      ],
      notes: [
        "Shipped First-Class without tracking (under the $40 tracking threshold).",
        "The studio has the post office's dated retail receipt and a Certificate of Mailing (PS Form 3817) for this parcel, both from day 1.",
      ],
    }),
  },

  /* ───────────── Not as described: the glaze colour ───────────── */
  {
    id: "heldout-colour-partial-refund-agreed",
    story: "colour",
    change: "The buyer agreed in writing to keep the bowls for a $40.00 partial refund, which was sent, then disputed the full amount.",
    label: "fight",
    source: `Buyer accepts a partial refund to keep an item, then files a chargeback for the whole payment anyway; ${FORUM}.`,
    why: "The listing disclosed the colour shift and the buyer settled in writing; the seller should show the agreement and the partial refund already paid.",
    decidedBy: "text",
    apply: (s) => ({
      ...s,
      inbox: [
        ...s.inbox,
        { day: 8, hour: 14, from: "shop", text: "I understand. Instead of a return, I can refund $40.00 and you keep the bowls. Would that help?" },
        { day: 8, hour: 19, from: "buyer", text: "Yes, that's fair. Please go ahead, thanks." },
        { day: 9, hour: 10, from: "shop", text: "Done: $40.00 refunded through PayPal. It should show in a few days." },
      ],
      notes: [...s.notes, "A $40.00 partial refund was sent through PayPal on day 9, after the buyer agreed to it by email."],
    }),
  },
  {
    id: "heldout-colour-return-not-refunded",
    story: "colour",
    change: "The buyer sent the bowls back; they reached the studio unused on day 14 and no refund has been sent.",
    label: "accept",
    source:
      "Seller had the item back from a return and was then hit with a chargeback on the same sale; https://community.ebay.com/t5/Selling/Buyer-returned-item-and-then-filed-a-chargeback/m-p/34397505",
    why: "The buyer followed the return policy and the seller holds the goods, so the money is owed; this is a credit-not-processed case the seller can't win.",
    decidedBy: "text",
    apply: (s) => ({
      ...s,
      inbox: [
        ...s.inbox,
        { day: 9, hour: 12, from: "buyer", text: "Fine, I'll send them back. Posting them today." },
        { day: 15, hour: 9, from: "buyer", text: "Tracking says you got the bowls yesterday. When will I see the money?" },
      ],
      notes: [
        "Listing text says colour shifts from deep blue to green where the glaze pools.",
        "The returned bowls arrived at the studio on day 14, unused and in their original box (USPS return tracking 9405511206213859471128).",
        "No refund has been sent for this order.",
      ],
    }),
  },
  {
    id: "heldout-colour-wrong-set",
    story: "colour",
    change: "The studio packed an ash-white set instead of the tide-blue one; the buyer's photo shows white bowls.",
    label: "accept",
    source: `Buyer receives a different colourway from the one ordered, and the seller's "colours vary" note is the only defence; ${FORUM}.`,
    why: "A colour-variation disclaimer covers variation within the listed glaze, not a different glaze, so the item is materially not as described.",
    decidedBy: "text",
    apply: (s) => ({
      ...s,
      inbox: [
        {
          day: 6,
          hour: 19,
          from: "buyer",
          text: "The bowls arrived, but they're a pale grey-white, not blue at all. Did I get someone else's order? Photo attached.",
        },
        { day: 7, hour: 11, from: "shop", text: `Thanks ${firstName(s)}, let me check and get back to you.` },
        { day: 9, hour: 8, from: "buyer", text: "Any news? I really wanted the blue ones." },
      ],
      notes: [
        "No breakage reported.",
        "The packing slip for this order lists set ASH-14, an ash-white nesting set. The tide-blue set reserved for this order is still on the studio shelf.",
      ],
    }),
  },

  /* ───────────── "I didn't make this purchase" ───────────── */
  {
    id: "heldout-fraud-descriptor",
    story: "fraud",
    change: "On the day of the dispute the buyer emailed that they didn't recognise the charge at first, have the plates, and asked the bank to drop it.",
    label: "fight",
    source:
      "Seller keeps getting 'buyer doesn't recognize charge' disputes, some from buyers who later realise the statement name was the shop; https://community.ebay.com/t5/Selling/Buyer-Doesn-t-Recognize-Charge/m-p/33837169",
    why: "The cardholder admitted the purchase and receipt in writing from the order's email; a withdrawal isn't guaranteed, so the seller should respond with it.",
    decidedBy: "text",
    apply: (s) => ({
      ...s,
      inbox: [
        {
          day: 9,
          hour: 11,
          from: "buyer",
          text: `Hi, this is ${firstName(s)}. I saw a charge I didn't recognise and reported it to my bank before I realised it was my order from you. The plates reached my forwarding address and I'm keeping them. I've asked the bank to cancel the dispute.`,
        },
      ],
      notes: [...s.notes, "Card statements show the payment as PAYPAL *HALDENCERA."],
    }),
  },

  /* ───────────── "Charged twice" ───────────── */
  {
    id: "heldout-duplicate-two-orders",
    story: "duplicate",
    change: "There were two real orders: the buyer bought a second mug for their sister, said so by email, and both shipped in one box.",
    label: "fight",
    source: `Buyer disputes one of two same-amount charges as a duplicate, but they placed two separate orders on purpose; ${FORUM}.`,
    why: "Mastercard 4834 fails when the seller shows two separate transactions for separate goods, both delivered, and the buyer asked for both in writing.",
    decidedBy: "text",
    records: { refund: false },
    apply: (s) => ({
      ...s,
      inbox: [
        {
          day: 0,
          hour: 20,
          from: "buyer",
          text: "Just ordered the slate mug. My sister saw it over my shoulder and wants one too, so I'm placing a second order for her now. Could both go in one box?",
        },
        { day: 0, hour: 21, from: "buyer", text: "Second order is done!" },
        { day: 1, hour: 9, from: "shop", text: `Thanks ${firstName(s)}! Both mugs are going out together in one box today.` },
      ],
      history: [{ ref: "#1146", daysAgo: 11, item: "Slate speckle mug, 12 oz", total: "$46.00", outcome: "Shipped in the same box as this order, delivered" }],
      notes: ["Two separate orders were placed 14 minutes apart, each for one slate speckle mug at $46.00. Both mugs shipped together in one box under this order's tracking number."],
    }),
  },

  /* ───────────── Orders placed by the buyer's shopping agent ───────────── */
  {
    id: "heldout-agent-mandate-revoked",
    story: "agent-mandate",
    change: "The agent's own log shows the cardholder told it to hold off before checkout, and it bought anyway because the intent was still valid.",
    label: "accept",
    source: `Agent-commerce version of "my family member used my card after I said no": the cardholder withdrew consent before the purchase; ${FORUM}.`,
    why: "The seller's own exhibit shows the cardholder withdrew consent before the purchase, so the signed intent can't show this order was authorised.",
    decidedBy: "text",
    apply: (s) => {
      const t = s.agent!.transcript;
      return {
        ...s,
        agent: {
          ...s.agent!,
          transcript: [
            t[0],
            t[1],
            "Asked the cardholder to confirm the slate speckle set before buying.",
            "Cardholder replied: \"Hold off for now, I want to check with my partner first. Don't buy anything yet.\"",
            "The signed intent was still valid and the cart was within its limits, so continued to checkout.",
            t[3],
            t[4],
          ],
        },
        inbox: [{ day: 5, hour: 20, from: "buyer", text: "I told my agent not to buy these. I never approved this order." }],
      };
    },
  },
  {
    id: "heldout-agent-overreach-approved",
    story: "agent-overreach",
    change: "The agent asked before going over the $60.00 limit and the cardholder replied to buy the $104.00 set; later they emailed that it was a mistake.",
    label: "fight",
    source: `Agent-commerce version of a buyer who approved a purchase and later claims it wasn't what they wanted; ${FORUM}.`,
    why: "The cardholder approved the higher price in the agent's own log, the set matches its listing, and a return was offered, so not-as-described fails.",
    decidedBy: "text",
    apply: (s) => ({
      ...s,
      agent: {
        ...s.agent!,
        transcript: [
          "Searched 4 shops for a ceramic pour-over dripper that fits #2 filters.",
          "Halden Ceramics lists the dripper only as part of a set: Pour-over set, dripper and carafe, $96.00 plus $8.00 shipping.",
          "The set is $104.00 delivered, over the $60.00 limit, so asked the cardholder before buying.",
          "Cardholder replied: \"Yes, get the set, the carafe is fine. Go ahead at $104.\"",
          "Signed the cart mandate and paid with the cardholder's card through PayPal.",
          "Told the cardholder: ordered the pour-over set (dripper and carafe) from Halden Ceramics, $104.00.",
        ],
      },
      inbox: [
        {
          day: 5,
          hour: 18,
          from: "buyer",
          text: "My shopping agent ordered a $104 set when I asked for a dripper under $60. Can you take it back?",
        },
        { day: 6, hour: 10, from: "shop", text: `Hi ${firstName(s)}, returns are accepted within 30 days for unused pieces; return shipping is on the buyer.` },
      ],
    }),
  },
];
