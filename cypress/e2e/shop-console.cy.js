import { tokenFor, winFor, WINDOW_MS } from "../support/token";

const API = "https://api.test";

describe("Shop console", () => {
  describe("setup", () => {
    it("shows the setup form by default", () => {
      cy.visitConsole();
      cy.get("#setup").should("be.visible");
      cy.get("#live").should("not.have.class", "show");
    });

    it("requires a shop id and secret before starting", () => {
      cy.visitConsole();
      cy.get("#startBtn").click();
      cy.get("#setupErr").should("contain", "Shop ID and secret are both required");
      cy.get("#live").should("not.have.class", "show");
    });
  });

  describe("registering a new shop", () => {
    it("requires an API address before registering", () => {
      cy.visitConsole();
      cy.get("#regBtn").click();
      cy.get("#setupErr").should("contain", "Enter your API address first");
    });

    it("registers a shop and fills in the returned id/secret", () => {
      cy.visitConsole();
      cy.window().then((win) => cy.stub(win, "prompt").returns("Daily Grind"));
      cy.intercept("POST", `${API}/shop/register`, (req) => {
        expect(req.body).to.deep.equal({ name: "Daily Grind" });
        req.reply({ shopId: "shop123", secret: "super-secret-value", name: "Daily Grind", size: 10 });
      }).as("register");

      cy.get("#api").type(API);
      cy.get("#regBtn").click();
      cy.wait("@register");

      cy.get("#sid").should("have.value", "shop123");
      cy.get("#sec").should("have.value", "super-secret-value");
      cy.get("#setupErr").should("contain", "Shop created");
    });

    it("does not call the API if the register prompt is cancelled", () => {
      cy.visitConsole();
      cy.window().then((win) => cy.stub(win, "prompt").returns(null));
      let called = false;
      cy.intercept("POST", `${API}/shop/register`, () => { called = true; });

      cy.get("#api").type(API);
      cy.get("#regBtn").click();
      cy.get("#setupErr").should("not.contain", "Registering")
        .then(() => expect(called).to.be.false);
    });

    it("shows a friendly error if registration fails", () => {
      cy.visitConsole();
      cy.window().then((win) => cy.stub(win, "prompt").returns("Daily Grind"));
      cy.intercept("POST", `${API}/shop/register`, { statusCode: 500, body: { error: "boom" } });

      cy.get("#api").type(API);
      cy.get("#regBtn").click();
      cy.get("#setupErr").should("contain", "Couldn't register: boom");
    });
  });

  describe("showing the rotating signed QR", () => {
    const START = 1700000000000; // arbitrary fixed epoch, not aligned to a window boundary on purpose

    it("starts the till and encodes a correctly-signed token for the app URL", () => {
      cy.clock(START, ["Date", "setInterval", "clearInterval"]);
      cy.visitConsole();

      cy.get("#api").type(API);
      cy.get("#appurl").type("https://example.test/app/");
      cy.get("#sid").type("shop123");
      cy.get("#sec").type("super-secret-value");
      cy.get("#startBtn").click();

      cy.get("#live").should("have.class", "show");
      cy.get("#setup").should("not.be.visible");
      cy.get("#shopTitle").should("contain", "Your café");

      cy.then(() => tokenFor("super-secret-value", "shop123", winFor(START))).then((expected) => {
        const expectedData = `https://example.test/app/?scan=${encodeURIComponent(`shop123.${expected}`)}`;
        cy.get("#qr").should("have.attr", "data-qr-text", expectedData);
      });
      const expectedSecs = Math.ceil((WINDOW_MS - (START % WINDOW_MS)) / 1000);
      cy.get("#secs").should("contain", String(expectedSecs));
    });

    it("falls back to a bare shopId.token payload when no app URL is configured", () => {
      cy.clock(START, ["Date", "setInterval", "clearInterval"]);
      cy.visitConsole();

      cy.get("#api").type(API);
      cy.get("#sid").type("shop123");
      cy.get("#sec").type("super-secret-value");
      cy.get("#startBtn").click();

      cy.then(() => tokenFor("super-secret-value", "shop123", winFor(START))).then((expected) => {
        cy.get("#qr").should("have.attr", "data-qr-text", `shop123.${expected}`);
      });
    });

    it("rotates to a new, correctly-signed token when the 30s window elapses", () => {
      cy.clock(START, ["Date", "setInterval", "clearInterval"]);
      cy.visitConsole();
      cy.get("#api").type(API);
      cy.get("#sid").type("shop123");
      cy.get("#sec").type("super-secret-value");
      cy.get("#startBtn").click();

      cy.then(() => tokenFor("super-secret-value", "shop123", winFor(START))).then((firstToken) => {
        cy.get("#qr").should("have.attr", "data-qr-text", `shop123.${firstToken}`);
      });

      // Advance real virtual time past the next 30s window boundary.
      const msIntoWindow = START % WINDOW_MS;
      cy.tick(WINDOW_MS - msIntoWindow + 1000);

      cy.then(() => tokenFor("super-secret-value", "shop123", winFor(START) + 1)).then((nextToken) => {
        cy.get("#qr").should("have.attr", "data-qr-text", `shop123.${nextToken}`);
      });
    });

    it("counts down the seconds remaining in the current window", () => {
      cy.clock(START, ["Date", "setInterval", "clearInterval"]);
      cy.visitConsole();
      cy.get("#api").type(API);
      cy.get("#sid").type("shop123");
      cy.get("#sec").type("super-secret-value");
      cy.get("#startBtn").click();

      cy.get("#secs")
        .invoke("text")
        .then(Number)
        .then((initial) => {
          cy.tick(5000);
          cy.get("#secs").invoke("text").then(Number).should("eq", initial - 5);
        });
    });
  });

  describe("persisting the connected till", () => {
    it("restores a previously connected till from local storage on load", () => {
      cy.visitConsole({
        saved: { shopId: "shop123", secret: "super-secret-value", api: API, appUrl: "", name: "Daily Grind" },
      });
      cy.get("#live").should("have.class", "show");
      cy.get("#setup").should("not.be.visible");
      cy.get("#shopTitle").should("contain", "Daily Grind");
    });

    it("disconnects the till and returns to setup, clearing storage", () => {
      cy.visitConsole({
        saved: { shopId: "shop123", secret: "super-secret-value", api: API, appUrl: "", name: "Daily Grind" },
      });
      cy.get("#backLink").click();
      cy.get("#setup").should("be.visible");
      cy.window().its("localStorage").invoke("getItem", "shop-console").should("be.null");
    });
  });
});
