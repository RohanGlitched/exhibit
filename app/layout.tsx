import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Self-hosted (SIL OFL, app/fonts): next/font/google fetched these from Google at build time, and CI failed whenever
// that fetch did.
const sans = localFont({ src: "./fonts/public-sans-latin-wght-normal.woff2", weight: "100 900", variable: "--font-sans", display: "swap" });
const serif = localFont({
  src: [
    { path: "./fonts/source-serif-4-latin-wght-normal.woff2", weight: "200 900", style: "normal" },
    { path: "./fonts/source-serif-4-latin-wght-italic.woff2", weight: "200 900", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Exhibit: PayPal dispute responses, cross-examined before filing", template: "%s · Exhibit" },
  description:
    "Exhibit argues a PayPal seller's disputes and holds a hearing on the PDF PayPal will read: a simulated reviewer objects, the reason code's requirements card presses what is weak or missing, and an answer stands only when the checker matches it to the record it cites. Fight the cases you should win; refund the rest.",
  openGraph: { type: "website", siteName: "Exhibit" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#dce4ef" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
