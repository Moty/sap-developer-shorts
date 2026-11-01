import assert from "node:assert/strict";
import test from "node:test";
import { friendlyError } from "../src/web/private/error-messages.js";

test("private sign-in error copy keeps invalid accounts indistinguishable", () => {
  const invalid = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"];
  for (const code of invalid)
    assert.equal(
      friendlyError({ code, message: "Provider diagnostic" }),
      "Email or password is incorrect.",
    );
  assert.equal(
    friendlyError({ code: "auth/email-already-in-use" }),
    "The account could not be created. Try signing in or resetting your password.",
  );
  assert.match(friendlyError({ code: "auth/network-request-failed" }), /Check your connection/u);
});

test("private errors preserve server validation details and clarify pairing recovery", () => {
  const validation = new Error("Narration is 64 seconds. Shorten the script before producing.");
  assert.equal(friendlyError(validation), validation.message);
  assert.equal(
    friendlyError({
      code: "REVISION_CONFLICT",
      message: "Reload the saved revision before continuing.",
    }),
    "Reload the saved revision before continuing.",
  );
  assert.equal(
    friendlyError(new Error("Open My voices and listen to the current audition.")),
    "Open Voices & presenters and listen to the current audition.",
  );
  assert.match(friendlyError({ code: "PAIRING_EXPIRED" }), /Start a new pairing on the Mac/u);
  assert.match(friendlyError({ code: "PAIRING_CODE" }), /six-digit code/u);
  assert.equal(friendlyError("Upload interrupted."), "Upload interrupted.");
  assert.match(friendlyError(new TypeError("Failed to fetch")), /Check your connection/u);
  assert.equal(friendlyError({ message: 123 }), "This request could not finish. Try again.");
  assert.equal(friendlyError(null), "This request could not finish. Try again.");
});
