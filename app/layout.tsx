import type { Metadata, Viewport } from "next";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const sans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"], style: ["normal", "italic"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Exhibit: the dispute desk for PayPal sellers", template: "%s · Exhibit" },
  description:
    "Exhibit reads every PayPal dispute, gathers the order, payment and tracking, and writes a response where every sentence points to the record that proves it. Fight the cases you should win; refund the rest.",
  openGraph: { type: "website", siteName: "Exhibit" },
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
