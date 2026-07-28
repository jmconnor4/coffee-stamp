// Validates the exact HMAC token scheme the Worker and shop console both use.
const WINDOW_MS = 30000;
const enc = new TextEncoder();

async function importKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
function b64url(buf) {
  let s = Buffer.from(buf).toString('base64');
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function token(secret, shopId, win) {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${shopId}:${win}`));
  return b64url(sig).slice(0, 20);
}
// Server-side verification: accepts current or previous window (clock skew / slow scan).
async function verify(secret, shopId, presented) {
  const now = Date.now();
  const win = Math.floor(now / WINDOW_MS);
  for (const w of [win, win - 1]) {
    if (presented === await token(secret, shopId, w)) return { ok: true, window: w };
  }
  return { ok: false };
}

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? (pass++, console.log('  ok  ', name)) : (fail++, console.log(' FAIL ', name)); };

const secret = 'shop-secret-abc123';
const shopId = 'gr7k2m';

const win = Math.floor(Date.now() / WINDOW_MS);
const good = await token(secret, shopId, win);
check('valid current-window token accepts', (await verify(secret, shopId, good)).ok);

const prev = await token(secret, shopId, win - 1);
check('previous-window token accepts', (await verify(secret, shopId, prev)).ok);

const stale = await token(secret, shopId, win - 2);
check('stale token (2 windows old) rejected', !(await verify(secret, shopId, stale)).ok);

const forged = await token('attacker-guess', shopId, win);
check('forged token (wrong secret) rejected', !(await verify(secret, shopId, forged)).ok);

const otherShopTok = await token(secret, 'different-shop', win);
check('token bound to its own shop only', !(await verify(secret, shopId, otherShopTok)).ok);

const claims = new Set();
function claim(uid, shopId, w) {
  const k = `${uid}:${shopId}:${w}`;
  if (claims.has(k)) return false;
  claims.add(k); return true;
}
check('first claim in window succeeds', claim('user1', shopId, win) === true);
check('replay in same window blocked', claim('user1', shopId, win) === false);
check('different user same window allowed', claim('user2', shopId, win) === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
