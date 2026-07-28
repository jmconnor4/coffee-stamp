// Inline replacements for the CDN-hosted QR libraries, kept as plain strings
// (rather than fixture files) so Cypress never tries to JSON-parse them.

// start() never settles, mimicking a permission prompt that's still open.
// Used to test opening/cancelling the scan modal without racing an async
// camera failure.
export const HTML5_QRCODE_PENDING = `
window.Html5Qrcode = function (elementId) { this.elementId = elementId; };
window.Html5Qrcode.prototype.start = function () { return new Promise(() => {}); };
window.Html5Qrcode.prototype.stop = function () { return Promise.resolve(); };
window.Html5Qrcode.prototype.clear = function () {};
`;

// start() rejects immediately, mimicking a headless/no-camera environment.
export const HTML5_QRCODE_REJECT = `
window.Html5Qrcode = function (elementId) { this.elementId = elementId; };
window.Html5Qrcode.prototype.start = function () { return Promise.reject(new Error("no camera in test env")); };
window.Html5Qrcode.prototype.stop = function () { return Promise.resolve(); };
window.Html5Qrcode.prototype.clear = function () {};
`;

// start() immediately "decodes" whatever text the test placed on
// window.__CYPRESS_DECODED_TEXT__, then stays pending (as the real scanner
// does while it keeps watching the camera feed).
export const HTML5_QRCODE_DECODE = `
window.Html5Qrcode = function (elementId) { this.elementId = elementId; };
window.Html5Qrcode.prototype.start = function (cameraConfig, config, onSuccess) {
  Promise.resolve().then(() => onSuccess(window.__CYPRESS_DECODED_TEXT__ || "stub.token"));
  return new Promise(() => {});
};
window.Html5Qrcode.prototype.stop = function () { return Promise.resolve(); };
window.Html5Qrcode.prototype.clear = function () {};
`;

// Instead of drawing pixels, records the exact string it was asked to encode
// as a data-qr-text attribute, so tests can assert the shop console signed
// the right payload without needing a QR decoder.
export const QRCODEJS_STUB = `
window.QRCode = function (el, opts) {
  const node = el && el.nodeType ? el : document.getElementById(el);
  node.innerHTML = "";
  node.setAttribute("data-qr-text", opts.text);
};
window.QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
`;
