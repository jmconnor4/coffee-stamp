import {
  HTML5_QRCODE_PENDING,
  HTML5_QRCODE_REJECT,
  HTML5_QRCODE_DECODE,
  QRCODEJS_STUB,
} from "./stubs";

const HTML5_QRCODE_STUBS = {
  pending: HTML5_QRCODE_PENDING,
  reject: HTML5_QRCODE_REJECT,
  decode: HTML5_QRCODE_DECODE,
};

// Visits the customer wallet app with the html5-qrcode CDN script replaced by
// a local stub (so tests don't depend on network access or a real camera) and
// optional seeded localStorage.
//
// options:
//   api        - value to seed into localStorage "cc-api"
//   uid        - value to seed into localStorage "cc-uid" (defaults to a fixed test uid)
//   cache      - array to seed into localStorage "cc-cards" (JSON-encoded)
//   query      - query string appended to the URL, e.g. "?scan=shop1.token"
//   qrBehavior - "pending" (default, start() never settles) | "reject" (camera unavailable)
//                | "decode" (start() immediately reports window.__CYPRESS_DECODED_TEXT__)
Cypress.Commands.add("visitApp", (options = {}) => {
  const {
    api,
    uid = "cy-test-uid",
    cache,
    query = "",
    qrBehavior = "pending",
  } = options;

  cy.intercept("GET", "**/service-worker.js", { statusCode: 404 });
  cy.intercept("GET", "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/**", {
    headers: { "content-type": "application/javascript" },
    body: HTML5_QRCODE_STUBS[qrBehavior],
  });
  cy.visit(`/app/index.html${query}`, {
    onBeforeLoad(win) {
      if (api) win.localStorage.setItem("cc-api", api);
      if (uid) win.localStorage.setItem("cc-uid", uid);
      if (cache) win.localStorage.setItem("cc-cards", JSON.stringify(cache));
    },
  });
});

// Visits the shop till console with the qrcodejs CDN script replaced by a
// local stub that records the exact encoded string instead of drawing pixels.
//
// options:
//   saved - object to seed into localStorage "shop-console" (restores a connected till)
Cypress.Commands.add("visitConsole", (options = {}) => {
  const { saved } = options;

  cy.intercept("GET", "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/**", {
    headers: { "content-type": "application/javascript" },
    body: QRCODEJS_STUB,
  });
  cy.visit("/shop/console.html", {
    onBeforeLoad(win) {
      if (saved) win.localStorage.setItem("shop-console", JSON.stringify(saved));
    },
  });
});
