const API = "https://api.test";

describe("Customer wallet app", () => {
  describe("empty state and settings", () => {
    it("shows the empty state and asks for an API address when none is configured", () => {
      cy.visitApp();
      cy.get("#cards .empty h2").should("contain", "No cards yet");
      cy.get("#sync").should("contain", "Tap Settings to add your API address");
    });

    it("saves an API address from Settings and triggers a sync", () => {
      cy.intercept("GET", `${API}/cards*`, { cards: [] }).as("cards");
      cy.visitApp();

      cy.get("#gear").click();
      cy.get("#settingsView").should("be.visible");
      cy.get("#apiInput").clear().type(API);
      cy.get("#saveApi").click();

      cy.get("#modal").should("not.have.class", "show");
      cy.get("#toast").should("contain", "Saved");
      cy.wait("@cards");
      cy.window()
        .its("localStorage")
        .invoke("getItem", "cc-api")
        .should("eq", API);
    });

    it("pre-fills Settings with the previously saved API address", () => {
      cy.visitApp({ api: API });
      cy.intercept("GET", `${API}/cards*`, { cards: [] });
      cy.get("#gear").click();
      cy.get("#apiInput").should("have.value", API);
    });
  });

  describe("rendering synced cards", () => {
    it("renders the correct number of stamped and empty slots", () => {
      const cards = [
        { shopId: "s1", shopName: "Daily Grind", stamps: 3, size: 10, freeEarned: 0, totalStamps: 3 },
      ];
      cy.intercept("GET", `${API}/cards*`, { cards }).as("cards");
      cy.visitApp({ api: API });
      cy.wait("@cards");

      cy.get(".card .c-name").should("contain", "Daily Grind");
      cy.get(".card .c-count").should("contain", "3 / 10");
      cy.get(".slot.stamped").should("have.length", 3);
      cy.get(".slot").not(".stamped").should("have.length", 7);
      cy.get(".slot.free").should("have.length", 1);
      cy.get(".redeem").should("not.exist");
    });

    it("renders one card per shop", () => {
      const cards = [
        { shopId: "s1", shopName: "Daily Grind", stamps: 2, size: 10, freeEarned: 0 },
        { shopId: "s2", shopName: "Roasters Two", stamps: 9, size: 10, freeEarned: 0 },
      ];
      cy.intercept("GET", `${API}/cards*`, { cards }).as("cards");
      cy.visitApp({ api: API });
      cy.wait("@cards");
      cy.get(".card").should("have.length", 2);
    });

    it("shows how many free coffees have been earned at a shop", () => {
      const cards = [
        { shopId: "s1", shopName: "Daily Grind", stamps: 1, size: 10, freeEarned: 2 },
      ];
      cy.intercept("GET", `${API}/cards*`, { cards });
      cy.visitApp({ api: API });
      cy.get(".earned").should("contain", "2 free earned here");
    });

    it("escapes untrusted shop names instead of rendering them as HTML", () => {
      const cards = [
        { shopId: "s1", shopName: "<img src=x onerror=alert(1)>", stamps: 1, size: 10, freeEarned: 0 },
      ];
      cy.intercept("GET", `${API}/cards*`, { cards });
      cy.visitApp({ api: API });
      cy.get(".c-name").should("have.text", "<img src=x onerror=alert(1)>");
      cy.get(".c-name img").should("not.exist");
    });

    it("falls back to cached cards and shows an offline indicator when the API is unreachable", () => {
      const cached = [
        { shopId: "s1", shopName: "Daily Grind", stamps: 2, size: 10, freeEarned: 0 },
      ];
      cy.intercept("GET", `${API}/cards*`, { forceNetworkError: true }).as("cardsFail");
      cy.visitApp({ api: API, cache: cached });
      cy.wait("@cardsFail");
      cy.get("#sync").should("contain", "Offline");
      cy.get(".c-name").should("contain", "Daily Grind");
    });
  });

  describe("redeeming a full card", () => {
    it("shows a redeem button once the card is full and redeems it", () => {
      const fullCard = { shopId: "s1", shopName: "Daily Grind", stamps: 10, size: 10, freeEarned: 1 };
      cy.intercept("GET", `${API}/cards*`, { cards: [fullCard] }).as("cards");
      cy.visitApp({ api: API });
      cy.wait("@cards");

      cy.get(".redeem").should("contain", "Redeem free coffee");

      const afterRedeem = { ...fullCard, stamps: 0 };
      cy.intercept("POST", `${API}/redeem`, (req) => {
        expect(req.body).to.deep.equal({ uid: "cy-test-uid", shopId: "s1" });
        req.reply({ card: afterRedeem, redeemed: true });
      }).as("redeem");
      cy.intercept("GET", `${API}/cards*`, { cards: [afterRedeem] }).as("cardsAfter");

      cy.get(".redeem").click();
      cy.wait("@redeem");
      cy.get("#toast").should("contain", "Enjoy your free coffee");
      cy.wait("@cardsAfter");
      cy.get(".c-count").should("contain", "0 / 10");
      cy.get(".redeem").should("not.exist");
    });

    it("shows the server's error if redeeming fails", () => {
      const fullCard = { shopId: "s1", shopName: "Daily Grind", stamps: 10, size: 10, freeEarned: 0 };
      cy.intercept("GET", `${API}/cards*`, { cards: [fullCard] });
      cy.visitApp({ api: API });
      cy.intercept("POST", `${API}/redeem`, { card: fullCard, error: "card not full" });
      cy.get(".redeem").click();
      cy.get("#toast").should("contain", "card not full");
    });
  });

  describe("stamping via a scanned QR (native camera hand-off)", () => {
    it("stamps automatically when opened via a ?scan= link and strips the query param", () => {
      const card = { shopId: "s1", shopName: "Daily Grind", stamps: 1, size: 10, freeEarned: 0 };
      cy.intercept("POST", `${API}/stamp`, (req) => {
        expect(req.body).to.deep.equal({ uid: "cy-test-uid", payload: "s1.faketoken123" });
        req.reply({ card, stamped: true, full: false });
      }).as("stamp");
      cy.intercept("GET", `${API}/cards*`, { cards: [card] });

      cy.visitApp({ api: API, query: "?scan=s1.faketoken123" });
      cy.wait("@stamp");
      cy.get("#toast").should("contain", "Stamped at Daily Grind");
      cy.location("search").should("eq", "");
    });

    it("shows a duplicate message on a same-window rescan", () => {
      const card = { shopId: "s1", shopName: "Daily Grind", stamps: 1, size: 10, freeEarned: 0 };
      cy.intercept("POST", `${API}/stamp`, { card, duplicate: true }).as("stamp");
      cy.intercept("GET", `${API}/cards*`, { cards: [card] });
      cy.visitApp({ api: API, query: "?scan=s1.already-used" });
      cy.wait("@stamp");
      cy.get("#toast").should("contain", "Already stamped for this code");
    });

    it("celebrates when a scan completes the card", () => {
      const card = { shopId: "s1", shopName: "Daily Grind", stamps: 10, size: 10, freeEarned: 0 };
      cy.intercept("POST", `${API}/stamp`, { card, stamped: true, full: true }).as("stamp");
      cy.intercept("GET", `${API}/cards*`, { cards: [card] });
      cy.visitApp({ api: API, query: "?scan=s1.lasttoken" });
      cy.wait("@stamp");
      cy.get("#toast").should("contain", "Daily Grind: card full!");
    });

    it("surfaces the server's error for a bad or expired code", () => {
      cy.intercept("POST", `${API}/stamp`, { error: "code expired or invalid" }).as("stamp");
      cy.intercept("GET", `${API}/cards*`, { cards: [] });
      cy.visitApp({ api: API, query: "?scan=s1.stale" });
      cy.wait("@stamp");
      cy.get("#toast").should("contain", "code expired or invalid");
    });

    it("shows a network error toast when the stamp request can't reach the server", () => {
      cy.intercept("POST", `${API}/stamp`, { forceNetworkError: true }).as("stamp");
      cy.intercept("GET", `${API}/cards*`, { cards: [] });
      cy.visitApp({ api: API, query: "?scan=s1.whatever" });
      cy.wait("@stamp");
      cy.get("#toast").should("contain", "Couldn't reach the shop server");
    });

    it("tells you to configure an API address if none is set yet", () => {
      cy.visitApp({ query: "?scan=s1.whatever" });
      cy.get("#toast").should("contain", "Add your API address in Settings first");
    });
  });

  describe("scanning via the in-app camera button", () => {
    it("opens the scan modal and lets you cancel", () => {
      cy.visitApp({ api: API, qrBehavior: "pending" });
      cy.intercept("GET", `${API}/cards*`, { cards: [] });
      cy.get("#scanBtn").click();
      cy.get("#modal").should("have.class", "show");
      cy.get("#scanView").should("be.visible");
      cy.get("#reader").should("exist");
      cy.get("#closeScan").click();
      cy.get("#modal").should("not.have.class", "show");
    });

    it("shows a toast when the camera is unavailable", () => {
      cy.visitApp({ api: API, qrBehavior: "reject" });
      cy.intercept("GET", `${API}/cards*`, { cards: [] });
      cy.get("#scanBtn").click();
      cy.get("#toast").should("contain", "Camera unavailable");
      cy.get("#modal").should("not.have.class", "show");
    });

    it("stamps when a code is successfully decoded", () => {
      const card = { shopId: "s1", shopName: "Daily Grind", stamps: 4, size: 10, freeEarned: 0 };
      cy.intercept("POST", `${API}/stamp`, (req) => {
        expect(req.body).to.deep.equal({ uid: "cy-test-uid", payload: "s1.scanned-token" });
        req.reply({ card, stamped: true, full: false });
      }).as("stamp");
      cy.intercept("GET", `${API}/cards*`, { cards: [card] });

      cy.visitApp({ api: API, qrBehavior: "decode" });
      cy.window().then((win) => { win.__CYPRESS_DECODED_TEXT__ = "s1.scanned-token"; });
      cy.get("#scanBtn").click();

      cy.wait("@stamp");
      cy.get("#modal").should("not.have.class", "show");
      cy.get("#toast").should("contain", "Stamped at Daily Grind");
    });

    it("extracts the payload when the decoded text is a full URL (?scan=...)", () => {
      const card = { shopId: "s1", shopName: "Daily Grind", stamps: 5, size: 10, freeEarned: 0 };
      cy.intercept("POST", `${API}/stamp`, (req) => {
        expect(req.body).to.deep.equal({ uid: "cy-test-uid", payload: "s1.url-token" });
        req.reply({ card, stamped: true, full: false });
      }).as("stamp");
      cy.intercept("GET", `${API}/cards*`, { cards: [card] });

      cy.visitApp({ api: API, qrBehavior: "decode" });
      cy.window().then((win) => {
        win.__CYPRESS_DECODED_TEXT__ = "https://example.test/app/index.html?scan=s1.url-token";
      });
      cy.get("#scanBtn").click();
      cy.wait("@stamp");
    });
  });

  describe("device identity", () => {
    it("keeps the same device id across reloads", () => {
      cy.intercept("GET", `${API}/cards*`, { cards: [] });
      cy.visitApp({ api: API });
      cy.window().its("localStorage").invoke("getItem", "cc-uid").should("be.a", "string").and("not.be.empty");
      cy.reload();
      cy.window().its("localStorage").invoke("getItem", "cc-uid").should("eq", "cy-test-uid");
    });
  });
});
