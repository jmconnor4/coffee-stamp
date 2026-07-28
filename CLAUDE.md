# Coffee Stamp Card — project guide

A coffee loyalty stamp system. A customer holds one card per shop; shops authorize
stamps with a rotating, signed QR code so customers can't self-stamp. No user accounts.

## Layout

- `api/worker.js` — Cloudflare Worker. All API logic + KV access. No framework.
- `api/wrangler.toml` — deploy config. Needs a KV namespace id pasted in (see below).
- `shop/console.html` — the till screen. Holds the shop secret locally, computes the
  rotating token in-browser, renders it as a QR every 30s.
- `app/index.html` — customer wallet PWA (multi-shop). Scans codes, syncs cards, works offline.
- `app/manifest.webmanifest`, `app/service-worker.js`, `app/icons/` — PWA shell.
- `test/test-core.mjs` — unit tests for the token sign/verify + dedup logic.
- `test/test-api.mjs` — integration tests driving the worker through the full lifecycle.
- `cypress/e2e/customer-app.cy.js` — e2e coverage of `app/index.html`: empty state, Settings,
  syncing/rendering cards, redeeming, stamping (both the `?scan=` native-camera hand-off and
  the in-app scan button), offline fallback, XSS-safety of shop names.
- `cypress/e2e/shop-console.cy.js` — e2e coverage of `shop/console.html`: setup validation,
  shop registration, the rotating signed QR (verified byte-for-byte against an independent
  HMAC implementation in `cypress/support/token.js`), session persistence, disconnect.
- `cypress/support/commands.js`, `cypress/support/stubs.js` — `visitApp`/`visitConsole` helpers
  that stub the CDN-hosted `html5-qrcode`/`qrcodejs` scripts so the suite runs deterministically
  offline, with no real camera.
- `README.md` — deploy + usage walkthrough.

## Run the tests

Unit + integration tests, from the repo root (Node 18+; uses global `crypto.subtle`, `fetch`,
`Request`/`Response`):

    node test/test-core.mjs
    node test/test-api.mjs

Both should print `8 passed, 0 failed`. Run these after any change to the token scheme
or worker logic.

End-to-end tests (Cypress, against the static `app/` and `shop/` files, with the API mocked
via `cy.intercept`):

    npm install
    npm run test:e2e        # headless, spins up a static server automatically
    npm run test:e2e:open   # interactive runner

Run these after any change to either front-end's markup, IDs/classes, or user-facing flow —
the specs assert on DOM structure (element ids like `#scanBtn`, `#qr`, classes like `.redeem`),
so a rename there means updating the matching spec too.

## Deploy

    cd api
    npx wrangler login
    npx wrangler kv namespace create CARDS   # paste the printed id into wrangler.toml
    npx wrangler deploy
    # optional, once live: npx wrangler secret put ADMIN_KEY  (gates /shop/register)

Host `app/` and `shop/` on any static host (GitHub Pages, Cloudflare Pages, Netlify).
Then set the API URL in the app's Settings and in the shop console.

## How the security works (don't break this)

- Token = `base64url(HMAC_SHA256(secret, "<shopId>:<win>")).slice(0,20)`,
  where `win = floor(Date.now() / 30000)` (a 30-second window).
- The server accepts the current or previous window only, so codes expire within ~60s.
- Dedup: one stamp per `claim:<uid>:<shopId>:<win>` key (KV, 120s TTL). Same phone can't
  double-claim a window; a screenshot goes stale within a minute.

**This exact algorithm is duplicated in three places: `api/worker.js`, `shop/console.html`,
and `test/test-core.mjs`.** If you change `WINDOW_MS` (30000), `CARD_SIZE` (10), the token
length, or the derivation string, change it in ALL of them or codes stop verifying.

## Data model (Cloudflare KV)

- `shop:<shopId>` → `{ name, secret, size, createdAt }`
- `card:<uid>:<shopId>` → `{ shopId, shopName, stamps, freeEarned, totalStamps, size, updatedAt }`
- `claim:<uid>:<shopId>:<win>` → `"1"` (expiring)

## API

- `POST /shop/register` `{ name }` → `{ shopId, secret, size }`
- `POST /stamp` `{ uid, payload }` → `{ card, stamped | duplicate | full }` (payload = `"shopId.token"`)
- `POST /redeem` `{ uid, shopId }` → `{ card, redeemed }`
- `GET  /cards?uid=...` → `{ cards: [...] }`

## Front-end conventions

- Design tokens: bg `#1c1512`, parchment `#f0e6d2`, ink `#3a2a1e`, gold `#d4a24e`, red `#b5432f`.
- Fonts: Bricolage Grotesque (display), Space Mono (body).
- The app uses `localStorage` for the device id (`cc-uid`), API address (`cc-api`), and a
  card cache (`cc-cards`). This is fine here — these are standalone hosted files, not a
  Claude artifact.
- Service worker caches the app shell + fonts and passes API calls straight to the network.

## Privacy model

Pseudonymous, not fully anonymous. Each phone gets a random `crypto.randomUUID` id. The
server stores only `randomID → shop → count` — no name, email, or login. Keep it that way.

## Open trade-offs / good next tasks

1. **Redemption is customer-initiated in the app.** Before a real rollout, gate the free
   coffee behind a staff action (e.g. the customer shows a short redeem code the till
   confirms) so it can't be claimed away from the counter. This is the top priority.
2. **Codes are shop-wide and time-based.** Optional upgrade: one-time per-purchase codes
   (a nonce the till generates per sale) for higher security, at the cost of a tap per sale.
3. **No cross-device sync.** Cards are tied to one phone's random id. A "transfer card"
   flow (export/import the id) would let a customer move to a new phone.
