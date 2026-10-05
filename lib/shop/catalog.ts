/**
 * The demo seller: a small, fictional ceramics studio that sells online and takes PayPal. Its catalogue,
 * policies and order book stand in for the store platform (Shopify, Etsy, WooCommerce) that a real seller
 * would connect. Everything PayPal-side (payments, tracking, disputes) is real sandbox data.
 */
export const SHOP = {
  name: "Halden Ceramics",
  owner: "Ines Halden",
  email: "studio@halden-ceramics.example",
  site: "halden-ceramics.example",
  returnAddress: {
    address_line_1: "88 Kiln Row",
    admin_area_2: "Portland",
    admin_area_1: "OR",
    postal_code: "97214",
    country_code: "US",
  },
  policies: {
    returns:
      "Returns accepted within 30 days of delivery for unused pieces in original packaging. The buyer pays return shipping unless the piece arrived damaged.",
    variation:
      "Every piece is thrown and glazed by hand. Glaze colour and speckling vary from kiln to kiln, and listing photos show a representative piece, not the exact one you receive.",
    shipping:
      "Orders over $40 ship USPS Ground Advantage with tracking, and signature confirmation over $100. Orders under $40 ship First-Class without tracking unless the buyer adds it.",
    damage: "Report breakage within 7 days with a photo of the piece and the box. We replace or refund broken pieces.",
  },
} as const;

export interface Product {
  sku: string;
  name: string;
  price: string;
  listing: string;
  photos: number;
}

export const PRODUCTS: Product[] = [
  {
    sku: "HC-MUG-SLATE",
    name: "Slate speckle mug, 12 oz",
    price: "38.00",
    listing: "Wheel-thrown stoneware mug in our slate speckle glaze. Holds 12 oz. Dishwasher and microwave safe. Glaze varies by firing.",
    photos: 5,
  },
  {
    sku: "HC-SET-POUR",
    name: "Pour-over set, dripper and carafe",
    price: "96.00",
    listing: "Hand-thrown ceramic dripper (fits #2 filters) with a 600 ml carafe in oat glaze. Ships in a double box.",
    photos: 7,
  },
  {
    sku: "HC-BOWL-NEST",
    name: "Nesting bowls, set of three",
    price: "124.00",
    listing: "Three nesting serving bowls (6, 8 and 10 in) in tide-blue glaze. Each set is unique; colour shifts from deep blue to green where the glaze pools.",
    photos: 6,
  },
  {
    sku: "HC-VASE-TALL",
    name: "Tall bud vase",
    price: "22.00",
    listing: "11 in bud vase in matte bone glaze. Watertight. Small and light, ships First-Class.",
    photos: 4,
  },
  {
    sku: "HC-PLATE-DIN",
    name: "Dinner plates, set of four",
    price: "168.00",
    listing: "Four 10.5 in dinner plates in slate speckle. Dishwasher safe. Ships with signature confirmation.",
    photos: 6,
  },
];

export const product = (sku: string) => PRODUCTS.find((p) => p.sku === sku)!;
