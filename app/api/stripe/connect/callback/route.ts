import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/app/(database)/lib/prisma";
import { encryptString } from "@/app/(database)/lib/crypto";

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// TEMP until you have auth: same as /start
async function getUserIdOrThrow() {
  const demoEmail = "founder@invoiceping.dev";
  const user = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (!user) throw new Error("Demo user not found. Run `npx prisma db seed`.");
  return user.id;
}

type StripeOAuthTokenResponse =
  | {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      scope: string;
      livemode: boolean;
      stripe_user_id: string; // connected account id (acct_...)
    }
  | {
      error: string;
      error_description?: string;
    };

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Stripe may send these:
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // If user cancels in Stripe UI:
  if (error) {
    return NextResponse.redirect(
      new URL(`/billing?stripe=error&reason=${encodeURIComponent(errorDescription ?? error)}`, url.origin)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL(`/billing?stripe=error&reason=missing_code_or_state`, url.origin));
  }

  const userId = await getUserIdOrThrow();

  // 1) Validate OAuth state (CSRF protection)
  const stateHash = sha256(state);
  const stateRow = await prisma.oAuthState.findUnique({
    where: { tokenHash: stateHash },
  });

  if (!stateRow) {
    return NextResponse.redirect(new URL(`/billing?stripe=error&reason=invalid_state`, url.origin));
  }

  if (stateRow.userId !== userId) {
    return NextResponse.redirect(new URL(`/billing?stripe=error&reason=state_user_mismatch`, url.origin));
  }

  if (stateRow.consumedAt) {
    return NextResponse.redirect(new URL(`/billing?stripe=error&reason=state_already_used`, url.origin));
  }

  if (stateRow.expiresAt.getTime() < Date.now()) {
    return NextResponse.redirect(new URL(`/billing?stripe=error&reason=state_expired`, url.origin));
  }

  // Mark state as consumed (one-time use)
  await prisma.oAuthState.update({
    where: { tokenHash: stateHash },
    data: { consumedAt: new Date() },
  });

  // 2) Exchange code -> tokens
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return NextResponse.redirect(new URL(`/billing?stripe=error&reason=missing_stripe_secret`, url.origin));
  }

  const redirectUri = process.env.STRIPE_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    return NextResponse.redirect(new URL(`/billing?stripe=error&reason=missing_redirect_uri`, url.origin));
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    // Stripe recommends including redirect_uri if you used one in /authorize
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const tokenJson = (await tokenRes.json()) as StripeOAuthTokenResponse;

  if (!tokenRes.ok || "error" in tokenJson) {
    const reason =
      "error" in tokenJson
        ? `${tokenJson.error}${tokenJson.error_description ? `: ${tokenJson.error_description}` : ""}`
        : "unknown_token_exchange_error";

    return NextResponse.redirect(new URL(`/billing?stripe=error&reason=${encodeURIComponent(reason)}`, url.origin));
  }

  // 3) Encrypt + store tokens
  const accessTokenEnc = encryptString(tokenJson.access_token);
  const refreshTokenEnc = tokenJson.refresh_token ? encryptString(tokenJson.refresh_token) : null;

  await prisma.stripeConnection.upsert({
    where: { userId },
    update: {
      stripeAccountId: tokenJson.stripe_user_id,
      accessTokenEnc,
      refreshTokenEnc,
      scope: tokenJson.scope,
      tokenType: tokenJson.token_type,
      livemode: tokenJson.livemode,
      revokedAt: null,
      connectedAt: new Date(),
    },
    create: {
      userId,
      stripeAccountId: tokenJson.stripe_user_id,
      accessTokenEnc,
      refreshTokenEnc,
      scope: tokenJson.scope,
      tokenType: tokenJson.token_type,
      livemode: tokenJson.livemode,
      revokedAt: null,
      connectedAt: new Date(),
    },
  });

  // ✅ Done — redirect to billing
  return NextResponse.redirect(new URL(`/billing?stripe=connected`, url.origin));
}
