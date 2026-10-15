import type { NextConfig } from "next";

// Development only: NEXT_PUBLIC_ANALYTICS_SOURCE (an origin such as https://exhibit-desk.vercel.app) lets the
// analytics page read another desk's /api/analytics through this server, since a dev server's own desk holds
// only a few local briefs. Production builds never add the rewrite and always read their own desk.
const analyticsSource = process.env.NODE_ENV !== "production" ? process.env.NEXT_PUBLIC_ANALYTICS_SOURCE?.replace(/\/+$/, "") : undefined;

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return analyticsSource ? [{ source: "/api/analytics-remote", destination: `${analyticsSource}/api/analytics` }] : [];
  },
};

export default config;
