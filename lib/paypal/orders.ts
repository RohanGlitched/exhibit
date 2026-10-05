import "server-only";
import { paypal } from "./client";
import type { Money } from "./disputes";

export interface Address {
  address_line_1: string;
  address_line_2?: string;
  admin_area_2: string;
  admin_area_1: string;
  postal_code: string;
  country_code: string;
}

export interface Capture {
  id: string;
  status: string;
  amount: Money;
  create_time: string;
  seller_receivable_breakdown?: { gross_amount?: Money; paypal_fee?: Money; net_amount?: Money };
  processor_response?: { avs_code?: string; cvv_code?: string; response_code?: string };
  network_transaction_reference?: { id?: string; network?: string };
}

export interface Tracker {
  id: string;
  status?: string;
  number?: string;
  carrier?: string;
  create_time?: string;
}

export interface Order {
  id: string;
  status: string;
  create_time: string;
  update_time?: string;
  intent: string;
  payer?: { name?: { given_name?: string; surname?: string }; email_address?: string; payer_id?: string };
  payment_source?: {
    card?: { name?: string; last_digits?: string; brand?: string; type?: string; authentication_result?: unknown };
    paypal?: { email_address?: string; account_id?: string; name?: { given_name?: string; surname?: string } };
  };
  purchase_units: {
    reference_id?: string;
    invoice_id?: string;
    custom_id?: string;
    description?: string;
    amount: Money;
    items?: { name: string; quantity: string; unit_amount: Money; sku?: string; description?: string }[];
    shipping?: { name?: { full_name?: string }; address?: Address; trackers?: Tracker[] };
    payments?: { captures?: Capture[] };
  }[];
}

export const getOrder = (id: string) => paypal<Order>(`/v2/checkout/orders/${encodeURIComponent(id)}`, { what: "Reading the order" });

export const getCapture = (id: string) =>
  paypal<Capture & { supplementary_data?: { related_ids?: { order_id?: string } } }>(`/v2/payments/captures/${encodeURIComponent(id)}`, {
    what: "Reading the payment",
  });

export interface CardBuyer {
  name: string;
  email: string;
  card: { number: string; expiry: string; security_code: string };
  address: Address;
}

export interface LineItem {
  name: string;
  sku: string;
  price: string;
  quantity: number;
  description: string;
}

/** One-step card checkout in the sandbox: create with intent CAPTURE and a card source, returns COMPLETED. */
export async function cardCheckout(opts: {
  buyer: CardBuyer;
  items: LineItem[];
  shippingCost: string;
  invoiceId: string;
  description: string;
}): Promise<Order> {
  const itemTotal = opts.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
  const total = (itemTotal + Number(opts.shippingCost)).toFixed(2);
  return paypal<Order>("/v2/checkout/orders", {
    requestId: crypto.randomUUID(),
    headers: { prefer: "return=representation" },
    what: "Taking the sandbox payment",
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: opts.invoiceId,
          invoice_id: opts.invoiceId,
          description: opts.description,
          amount: {
            currency_code: "USD",
            value: total,
            breakdown: {
              item_total: { currency_code: "USD", value: itemTotal.toFixed(2) },
              shipping: { currency_code: "USD", value: opts.shippingCost },
            },
          },
          items: opts.items.map((i) => ({
            name: i.name,
            sku: i.sku,
            description: i.description.slice(0, 127),
            quantity: String(i.quantity),
            unit_amount: { currency_code: "USD", value: i.price },
            category: "PHYSICAL_GOODS",
          })),
          shipping: { name: { full_name: opts.buyer.name }, address: opts.buyer.address },
        },
      ],
      payment_source: {
        card: {
          name: opts.buyer.name,
          number: opts.buyer.card.number,
          expiry: opts.buyer.card.expiry,
          security_code: opts.buyer.card.security_code,
          billing_address: opts.buyer.address,
        },
      },
    },
  });
}

export interface Refund {
  id: string;
  status: string;
  amount?: Money;
  create_time?: string;
  note_to_payer?: string;
}

/** Refunds a capture in full, or in part when `amount` is given. */
export const refundCapture = (captureId: string, note: string, amount?: string) =>
  paypal<Refund>(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    requestId: crypto.randomUUID(),
    headers: { prefer: "return=representation" },
    what: "Refunding the payment",
    body: { note_to_payer: note.slice(0, 255), ...(amount ? { amount: { currency_code: "USD", value: amount } } : {}) },
  });

export const getRefund = (id: string) => paypal<Refund>(`/v2/payments/refunds/${encodeURIComponent(id)}`, { what: "Reading the refund" });

/** Adds a shipment tracker to a captured order (Orders v2 tracking). */
export const addTracking = (orderId: string, captureId: string, carrier: string, trackingNumber: string, items: LineItem[]) =>
  paypal<Order>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/track`, {
    what: "Adding the tracking number",
    body: {
      capture_id: captureId,
      tracking_number: trackingNumber,
      carrier,
      notify_payer: false,
      items: items.map((i) => ({ name: i.name, sku: i.sku, quantity: String(i.quantity) })),
    },
  });
