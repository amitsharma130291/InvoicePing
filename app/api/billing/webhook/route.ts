// app/api/billing/webhook/route.ts
import Stripe from "stripe";
import prisma from "@/app/(database)/lib/prisma";

export const runtime = "nodejs"; // required for Stripe signature verification

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * Stripe removed subscription-level current_period_end/start in newer API versions.
 * Billing periods now live on subscription items:
 *   subscription.items.data[].current_period_end
 */
function getCurrentPeriodEndFromItems(
  stripeSub: Stripe.Subscription,
): Date | null {
  const items = stripeSub.items?.data ?? [];
  const ends = items
    .map((it) => it.current_period_end)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  if (ends.length === 0) return null;

  // If multiple items exist, choose the latest end.
  const maxEnd = Math.max(...ends);
  return new Date(maxEnd * 1000);
}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing stripe-signature", { status: 400 });

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret)
    return new Response("Missing STRIPE_WEBHOOK_SECRET", { status: 500 });

  // IMPORTANT: raw body needed for signature verification
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const userId = session.metadata?.userId;
        const customerId = session.customer as string | null;
        const stripeSubscriptionId = session.subscription as string | null;

        // For Day 4: ACK 200 even if incomplete (avoid endless Stripe retries)
        if (!userId || !customerId || !stripeSubscriptionId) {
          console.warn("checkout.session.completed missing fields", {
            userId,
            customerId,
            stripeSubscriptionId,
          });
          break;
        }

        const stripeSubscription: Stripe.Subscription =
          await stripe.subscriptions.retrieve(stripeSubscriptionId);

        const currentPeriodEnd =
          getCurrentPeriodEndFromItems(stripeSubscription);

        await prisma.subscription.upsert({
          where: { userId },
          update: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: stripeSubscriptionId,
            status: stripeSubscription.status, // active, trialing, past_due, canceled, etc.
            currentPeriodEnd: currentPeriodEnd ?? undefined,
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end ?? false,
          },
          create: {
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: stripeSubscriptionId,
            status: stripeSubscription.status,
            currentPeriodEnd: currentPeriodEnd ?? undefined,
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end ?? false,
          },
        });

        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const stripeSubscription = event.data.object as Stripe.Subscription;
        const currentPeriodEnd =
          getCurrentPeriodEndFromItems(stripeSubscription);

        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: stripeSubscription.id },
          data: {
            status: stripeSubscription.status,
            currentPeriodEnd: currentPeriodEnd ?? undefined,
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end ?? false,
          },
        });

        break;
      }

      default:
        // ignore other events for Day 4
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    // Return 500 to make Stripe retry on real failures
    return new Response("Webhook handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
