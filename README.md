# Coffee Stamp Card — networked version

Three parts:

- `api/` — a Cloudflare Worker that verifies scanned codes and stores stamp counts.
- `shop/console.html` — the till screen that shows a rotating, signed QR code.
- `app/` — the customer wallet (installable PWA) that scans codes and holds a card per shop.

## How a stamp happens

1. The shop console signs a token with the shop's secret. The token changes every 30 seconds.
2. The console shows it as a QR code (a link back to the customer app).
3. A customer scans it. Their phone opens the app and posts `shopId.token` to the API.
4. The API recomputes the token with the secret it holds, checks it matches the current
   or previous 30-second window, and confirms this phone hasn't already claimed that window.
5. A stamp is added. Screenshots stop working within a minute, and nobody can self-stamp
   without a valid, current, shop-signed code.

## Privacy

No accounts, names, emails, or logins. Each phone gets a random ID (`crypto.randomUUID`).
The server only ever stores `randomID -> shop -> stamp count`. Clearing the browser or
switching phones starts fresh — that's the trade-off for having no login.

## Deploy the API (Cloudflare Workers — free tier)

    cd api
    npm install -g wrangler        # or: npx wrangler ...
    wrangler login
    wrangler kv namespace create CARDS   # copy the id it prints into wrangler.toml
    wrangler deploy

You'll get a URL like `https://coffee-stamp-card.<you>.workers.dev`.

Optional — require a key to register shops (recommended once you're live):

    wrangler secret put ADMIN_KEY

## Host the two front-ends (free static hosting)

Put `app/` and `shop/` on any static host (GitHub Pages, Cloudflare Pages, Netlify).
They're plain files. In the customer app, open Settings and paste the API URL.
In the shop console, paste the API URL, the customer-app URL, then register or connect a shop.

## Register your first shop

Open `shop/console.html`, enter the API URL, click "Register a new shop instead."
Save the Shop ID and secret it gives you, then press Start. The console begins showing codes.

## Testing

Unit + integration tests (no install beyond Node):

    node test/test-core.mjs
    node test/test-api.mjs

End-to-end tests (Cypress) covering both the customer app and shop console — the API is
mocked, and the CDN-hosted QR libraries are stubbed, so these run offline with no camera:

    npm install
    npm run test:e2e        # headless
    npm run test:e2e:open   # interactive runner

## Cost

Cloudflare's free tier covers 100,000 Worker requests/day and a generous KV allowance —
comfortably free for a single café. Static hosting for the two pages is free. No app-store fees.

## Endpoints

- `POST /shop/register` `{ name }` -> `{ shopId, secret }`
- `POST /stamp` `{ uid, payload }` -> `{ card, stamped|duplicate|full }`
- `POST /redeem` `{ uid, shopId }` -> `{ card, redeemed }`
- `GET  /cards?uid=...` -> `{ cards: [...] }`

## Known trade-offs / next steps

- Redemption is currently claimed in-app. For a real deployment, gate it behind a shop
  action (e.g. the customer shows a redeem code the till confirms) so a free coffee can't
  be claimed without staff present.
- Codes are shop-wide and time-based. For higher security, switch to one-time per-purchase
  codes (a nonce the till generates per sale). More secure, slightly more friction.
