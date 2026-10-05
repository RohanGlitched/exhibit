#!/bin/bash
# Pushes server env vars from .env.local to Vercel production without echoing values.
set -e
val() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }
for k in PAYPAL_CLIENT_ID PAYPAL_CLIENT_SECRET AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT AZURE_OPENAI_DEPLOYMENT AZURE_OPENAI_REASONING AZURE_OPENAI_MODEL_LABEL; do
  v="$(val $k)"; [ -n "$v" ] || { echo "missing $k"; exit 1; }
  npx vercel env rm $k production --yes >/dev/null 2>&1 || true
  printf '%s' "$v" | npx vercel env add $k production --sensitive >/dev/null 2>&1 && echo "set $k" || { printf '%s' "$v" | npx vercel env add $k production >/dev/null 2>&1 && echo "set $k (plain)"; }
done
secret="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
npx vercel env rm CRON_SECRET production --yes >/dev/null 2>&1 || true
printf '%s' "$secret" | npx vercel env add CRON_SECRET production --sensitive >/dev/null 2>&1 && echo "set CRON_SECRET"
grep -q '^CRON_SECRET=' .env.local || printf 'CRON_SECRET=%s\n' "$secret" >> .env.local
for kv in "DAILY_MODEL_CAP=400" "NEXT_PUBLIC_SITE_URL=https://exhibit-desk.vercel.app"; do
  k="${kv%%=*}"; v="${kv#*=}"; npx vercel env rm $k production --yes >/dev/null 2>&1 || true
  printf '%s' "$v" | npx vercel env add $k production >/dev/null 2>&1 && echo "set $k"
done
