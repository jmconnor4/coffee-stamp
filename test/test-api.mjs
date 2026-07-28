import worker from "../api/worker.js";

// Minimal in-memory KV that mimics the Workers KV surface the worker uses.
function mockKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}
const env = { CARDS: mockKV() };
const call = (method, path, body) =>
  worker.fetch(new Request("https://x" + path, {
    method, headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }), env);

// Recreate the token the shop console would show, so we can "scan" it.
const enc = new TextEncoder();
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function tokenFor(secret, shopId, win) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`${shopId}:${win}`))).slice(0, 20);
}
const curWin = () => Math.floor(Date.now() / 30000);

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log("  ok  ", n)) : (fail++, console.log(" FAIL ", n)); };

// 1. Register a shop
const reg = await (await call("POST", "/shop/register", { name: "Daily Grind" })).json();
check("register returns shopId + secret", !!reg.shopId && !!reg.secret);

const uid = "device-" + b64url(crypto.getRandomValues(new Uint8Array(8)));

// 2. Stamp with a valid current code
let code = `${reg.shopId}.${await tokenFor(reg.secret, reg.shopId, curWin())}`;
let res = await (await call("POST", "/stamp", { uid, payload: code })).json();
check("valid scan adds a stamp", res.stamped && res.card.stamps === 1);

// 3. Re-scanning the same window is a no-op
res = await (await call("POST", "/stamp", { uid, payload: code })).json();
check("same-window rescan is a duplicate", res.duplicate && res.card.stamps === 1);

// 4. A bogus code is rejected
res = await call("POST", "/stamp", { uid, payload: `${reg.shopId}.totally-made-up` });
check("bad code rejected (403)", res.status === 403);

// 5. Cards list shows the one card
let cards = (await (await call("GET", `/cards?uid=${uid}`)).json()).cards;
check("cards list returns the shop card", cards.length === 1 && cards[0].shopName === "Daily Grind");

// 6. Fill the card to 10 by advancing a mocked clock (each visit in a fresh 30s window)
const realNow = Date.now;
let fakeNow = realNow();
Date.now = () => fakeNow;
let last;
for (let i = 1; i < 10; i++) {
  fakeNow += 30000; // next window
  const w = Math.floor(fakeNow / 30000);
  const c = `${reg.shopId}.${await tokenFor(reg.secret, reg.shopId, w)}`;
  last = await (await call("POST", "/stamp", { uid, payload: c })).json();
}
check("card fills to 10 and reports full", last.card.stamps === 10 && last.full);

// 7. Redeem resets and banks a free coffee
const red = await (await call("POST", "/redeem", { uid, shopId: reg.shopId })).json();
check("redeem resets to 0 and credits free coffee", red.redeemed && red.card.stamps === 0 && red.card.freeEarned === 1);

// 8. A second shop makes a second, independent card
Date.now = realNow; // back to real time
const reg2 = await (await call("POST", "/shop/register", { name: "Roasters Two" })).json();
const code2 = `${reg2.shopId}.${await tokenFor(reg2.secret, reg2.shopId, curWin())}`;
await call("POST", "/stamp", { uid, payload: code2 });
cards = (await (await call("GET", `/cards?uid=${uid}`)).json()).cards;
check("multi-shop: two independent cards for one device", cards.length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
