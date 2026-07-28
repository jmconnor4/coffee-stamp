// Mirrors the HMAC token scheme shared by api/worker.js and shop/console.html
// (see CLAUDE.md "How the security works"), so e2e tests can independently
// verify the shop console signs the exact payload the server would accept.
const WINDOW_MS = 30000;
const enc = new TextEncoder();

function b64url(buf) {
  const s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function tokenFor(secret, shopId, win) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${shopId}:${win}`));
  return b64url(sig).slice(0, 20);
}

export const winFor = (ms) => Math.floor(ms / WINDOW_MS);
export { WINDOW_MS };
