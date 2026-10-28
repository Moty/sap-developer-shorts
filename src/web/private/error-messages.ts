/** UI copy only: keep server authorization and validation decisions unchanged. */
export function friendlyError(error: unknown): string {
  const details =
    error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : {};
  const messages: Record<string, string> = {
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "Email or password is incorrect.",
    "auth/email-already-in-use":
      "The account could not be created. Try signing in or resetting your password.",
    "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Choose a password with at least 8 characters.",
    "auth/network-request-failed":
      "We could not reach the sign-in service. Check your connection and try again.",
    "auth/user-disabled": "This account cannot sign in. Contact your workspace administrator.",
    "auth/operation-not-allowed":
      "Sign-in is unavailable for this workspace. Contact your workspace administrator.",
    WORKSPACE_UNAVAILABLE:
      "This workspace is unavailable. Check with your workspace administrator.",
    FORBIDDEN:
      "Your account does not have permission for this action. Check with your workspace administrator.",
    PAIRING_EXPIRED:
      "This pairing has expired or is unavailable. Start a new pairing on the Mac, then enter its new code in Settings.",
    PAIRING_CODE:
      "The pairing code does not match. Enter the six-digit code currently shown on the Mac.",
  };
  const message = typeof details.code === "string" ? messages[details.code] : undefined;
  if (message) return message;
  if (typeof details.message === "string" && details.message) {
    if (
      [
        "Failed to fetch",
        "Load failed",
        "NetworkError when attempting to fetch resource.",
      ].includes(details.message)
    )
      return "We could not reach the studio server. Check your connection and try again.";
    return details.message
      .replace(/\bMy voices\b/gu, "Voices & presenters")
      .replace(/\bMy photos\b/gu, "Presenters");
  }
  return typeof error === "string" && error ? error : "This request could not finish. Try again.";
}
