import type { Auth } from "firebase-admin/auth";
import { type Actor, fail } from "./contracts.js";
export type VerifyUser = (token: string) => Promise<Actor>;
export function firebaseUserVerifier(auth: Auth): VerifyUser {
  return async (token) => {
    try {
      const decoded = await auth.verifyIdToken(token, true);
      if (
        !decoded.email ||
        decoded.email_verified !== true ||
        decoded.firebase?.sign_in_provider !== "password"
      )
        fail(403, "EMAIL_UNVERIFIED", "Verify your email and sign in with your password.");
      return {
        uid: decoded.uid,
        email: decoded.email.toLowerCase(),
        authTime: decoded.auth_time * 1000,
      };
    } catch (error) {
      if (error instanceof Error && "status" in error) throw error;
      fail(401, "SIGN_IN_REQUIRED", "Sign in again to continue.");
    }
  };
}

/** Device leases also honor account disablement and refresh-token revocation. */
export function firebaseRenderPermission(auth: Auth) {
  return async (uid: string, authorizedAt: number) => {
    try {
      const user = await auth.getUser(uid);
      const validAfter = Date.parse(user.tokensValidAfterTime ?? "1970-01-01T00:00:00Z");
      return !user.disabled && Number.isFinite(authorizedAt) && authorizedAt >= validAfter;
    } catch {
      return false;
    }
  };
}
