import { describe, it, expect } from "vitest";
import { isAppPage } from "../src/clientApp.js";

// The pages that exist answer 200; anything else gets the app's "Page not
// found" with a real 404 status (no "soft 404" for search engines).
describe("which addresses are app pages", () => {
    it("the app's pages", () => {
        for (const page of ["/", "/login", "/register", "/register/google", "/discover", "/settings", "/chat", "/chat/", "/chat/64b0000000000000000000aa", "/u/riya_menon"]) {
            expect(isAppPage(page), page).toBe(true);
        }
    });

    it("anything else is a 404", () => {
        for (const page of ["/no-such-page", "/chat/nope", "/chat/64b0000000000000000000aa/extra", "/login/x", "/u/", "/u/a/b", "/wp-admin", "/.env", "/settings/../etc"]) {
            expect(isAppPage(page), page).toBe(false);
        }
    });
});
