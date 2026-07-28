// Coffee Stamp Card API — Cloudflare Worker
// Bindings (see wrangler.toml): KV namespace `CARDS`, optional secret `ADMIN_KEY`.
// Stores no personal data — only randomID -> shop -> stamp count.

const WINDOW_MS = 30000;   // QR rotates every 30s
const CARD_SIZE = 10;      // 9 stamps + 1 free
const enc = new TextEncoder();

/* ---------- helpers ---------- */
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}
function b64url(buf) {
  let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randId(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function tokenFor(secret, shopId, win) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${shopId}:${win}`));
  return b64url(sig).slice(0, 20);
}
function cleanId(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(v) ? v : null;
}

/* ---------- handlers ---------- */

// Create a shop. Returns its id + secret (the owner keeps the secret in the console).
async function registerShop(req, env) {
  if (env.ADMIN_KEY) {
    if (req.headers.get("x-admin-key") !== env.ADMIN_KEY) return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => ({}));
  const name = (body.name || "").toString().trim().slice(0, 40) || "My Café";
  const shopId = randId(5);               // ~8 chars
  const secret = randId(24);              // 32-char secret
  await env.CARDS.put(`shop:${shopId}`, JSON.stringify({ name, secret, size: CARD_SIZE, createdAt: Date.now() }));
  return json({ shopId, secret, name, size: CARD_SIZE });
}

// A scanned QR is redeemed here. Body: { uid, payload } where payload = "shopId.token".
async function stamp(req, env) {
  const body = await req.json().catch(() => ({}));
  const uid = cleanId(body.uid);
  if (!uid) return json({ error: "bad uid" }, 400);
  const [shopId, presented] = (body.payload || "").toString().split(".");
  if (!cleanId(shopId) || !presented) return json({ error: "bad code" }, 400);

  const shopRaw = await env.CARDS.get(`shop:${shopId}`);
  if (!shopRaw) return json({ error: "unknown shop" }, 404);
  const shop = JSON.parse(shopRaw);

  // Verify against current or previous window.
  const win = Math.floor(Date.now() / WINDOW_MS);
  let matchedWin = null;
  for (const w of [win, win - 1]) {
    if (presented === await tokenFor(shop.secret, shopId, w)) { matchedWin = w; break; }
  }
  if (matchedWin === null) return json({ error: "code expired or invalid" }, 403);

  const cardKey = `card:${uid}:${shopId}`;
  const existing = await env.CARDS.get(cardKey);
  const card = existing ? JSON.parse(existing)
    : { shopId, shopName: shop.name, stamps: 0, freeEarned: 0, totalStamps: 0, size: shop.size };

  // Dedup: one stamp per (uid, shop, window).
  const claimKey = `claim:${uid}:${shopId}:${matchedWin}`;
  const already = await env.CARDS.get(claimKey);
  if (already) return json({ card, duplicate: true });
  await env.CARDS.put(claimKey, "1", { expirationTtl: 120 });

  if (card.stamps < card.size) card.stamps += 1;
  card.totalStamps += 1;
  card.shopName = shop.name;
  card.updatedAt = Date.now();
  await env.CARDS.put(cardKey, JSON.stringify(card));
  return json({ card, stamped: true, full: card.stamps >= card.size });
}

// Claim a completed card. Body: { uid, shopId }.
async function redeem(req, env) {
  const body = await req.json().catch(() => ({}));
  const uid = cleanId(body.uid);
  const shopId = cleanId(body.shopId);
  if (!uid || !shopId) return json({ error: "bad request" }, 400);
  const cardKey = `card:${uid}:${shopId}`;
  const raw = await env.CARDS.get(cardKey);
  if (!raw) return json({ error: "no card" }, 404);
  const card = JSON.parse(raw);
  if (card.stamps < card.size) return json({ card, error: "card not full" }, 400);
  card.stamps = 0;
  card.freeEarned += 1;
  card.updatedAt = Date.now();
  await env.CARDS.put(cardKey, JSON.stringify(card));
  return json({ card, redeemed: true });
}

// List a user's cards. GET /cards?uid=...
async function getCards(req, env) {
  const uid = cleanId(new URL(req.url).searchParams.get("uid"));
  if (!uid) return json({ error: "bad uid" }, 400);
  const list = await env.CARDS.list({ prefix: `card:${uid}:` });
  const cards = [];
  for (const k of list.keys) {
    const raw = await env.CARDS.get(k.name);
    if (raw) cards.push(JSON.parse(raw));
  }
  cards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return json({ cards });
}

/* ---------- router ---------- */
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
    const { pathname: p } = new URL(req.url);
    try {
      if (req.method === "POST" && p === "/shop/register") return registerShop(req, env);
      if (req.method === "POST" && p === "/stamp") return stamp(req, env);
      if (req.method === "POST" && p === "/redeem") return redeem(req, env);
      if (req.method === "GET" && p === "/cards") return getCards(req, env);
      if (p === "/") return json({ ok: true, service: "coffee-stamp-card" });
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
