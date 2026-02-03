import { NextRequest } from "next/server";
import Stripe from "stripe";
import prisma from "@/app/(database)/lib/prisma";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
   apiVersion: "2026-01-28.clover",
});

// TEMP until real auth
async function getUserIdOrThrow() {
  const demoEmail = "founder@invoiceping.dev";
  const user = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (!user) throw new Error("Demo user not found. Run prisma seed.");
  return user.id;
}

export async function POST(req: NextRequest) {
  const userId = await getUserIdOrThrow();

  const priceId = process.env.STRIPE_PRICE_ID_PRO;
  if (!priceId) return new Response("Missing STRIPE_PRICE_ID_PRO", { status: 500 });

  const url = new URL(req.url);
  const successUrl = `${url.origin}/billing?checkout=success`;
  const cancelUrl = `${url.origin}/billing?checkout=cancel`;

  // Optional: reuse existing customer if you have one
  const existing = await prisma.subscription.findUnique({
    where: { userId },
    select: { stripeCustomerId: true },
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer: existing?.stripeCustomerId ?? undefined,
    allow_promotion_codes: true,
    metadata: { userId },
  });

  return Response.json({ url: session.url });
}
