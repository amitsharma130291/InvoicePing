import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/app/(database)/lib/prisma";

const STATE_TTL_MIN = 10;

// Hash state before storing (so even if DB leaks, attacker can't reuse it)
function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Replace this with your auth system.
 * For now, this is a dev placeholder:
 * - If you don't have auth yet, hardcode demo user from your seed.
 */
async function getUserIdOrThrow() {
  // ✅ TEMP DEV: use the seeded user
  const demoEmail = "founder@invoiceping.dev";
  const user = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (!user) throw new Error("Demo user not found. Run prisma db seed.");
  return user.id;

  // Later, replace with real auth (Clerk / NextAuth / etc)
}

export async function GET() {
  const userId = await getUserIdOrThrow();

  // You can't do OAuth without client id, so fail cleanly if not ready.
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Stripe Connect Client ID missing. Stripe dashboard hasn't generated it yet (Connect provisioning still pending).",
      },
      { status: 503 }
    );
  }

  const redirectUri = process.env.STRIPE_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    return NextResponse.json(
      { ok: false, message: "Missing STRIPE_OAUTH_REDIRECT_URI in .env" },
      { status: 500 }
    );
  }

  // 1) Generate secure random state token
  const rawState = crypto.randomBytes(32).toString("hex");

  // 2) Store state hash in DB with expiry (CSRF protection)
  await prisma.oAuthState.create({
    data: {
      userId,
      tokenHash: sha256(rawState),
      expiresAt: new Date(Date.now() + STATE_TTL_MIN * 60 * 1000),
    },
  });

  // 3) Redirect user to Stripe OAuth authorize endpoint
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "read_write",
    state: rawState,
    redirect_uri: redirectUri,
  });

  const stripeUrl = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
  return NextResponse.redirect(stripeUrl);
}
