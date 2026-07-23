import assert from "node:assert/strict";
import test from "node:test";

import {
  createSetupSession,
  readCookie,
  safeSetupReturnPath,
  verifySetupSession,
} from "./setup-auth.js";

test("setup sessions validate until expiry", () => {
  const now = Date.UTC(2026, 6, 23);
  const token = createSetupSession("secret", now);

  assert.equal(verifySetupSession(token, "secret", now), true);
  assert.equal(verifySetupSession(token, "wrong", now), false);
  assert.equal(
    verifySetupSession(token, "secret", now + 13 * 60 * 60 * 1000),
    false,
  );
});

test("cookie parsing handles encoded values", () => {
  assert.equal(
    readCookie("a=1; openclaw_setup=abc%2E123; c=3", "openclaw_setup"),
    "abc.123",
  );
  assert.equal(readCookie("a=1", "openclaw_setup"), null);
});

test("return paths stay within setup pages", () => {
  assert.equal(safeSetupReturnPath("/setup/storage"), "/setup/storage");
  assert.equal(safeSetupReturnPath("/logs"), "/logs");
  assert.equal(safeSetupReturnPath("https://example.com"), "/setup");
  assert.equal(safeSetupReturnPath("//example.com"), "/setup");
});
