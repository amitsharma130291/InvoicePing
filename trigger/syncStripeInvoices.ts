import { schedules } from "@trigger.dev/sdk";
import Stripe from "stripe";
import { prisma } from "../app/(database)/lib/prisma";

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateFromUnixSeconds(s?: number | null) {
  if (!s) return null;
  return new Date(s * 1000);
}

export const syncStripeInvoices = schedules.task({
  id: "sync-stripe-invoices",
  cron: "*/15 * * * *",
  run: async () => {
    const now = new Date();

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) throw new Error("Missing STRIPE_SECRET_KEY in env");

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16" as any,
    });

    // For MVP: pick the single demo user you already seed/use
    // If you have a real auth user model later, replace this logic.
    const user = await prisma.user.findFirst({
      where: { email: "founder@invoiceping.dev" },
    });

    if (!user) throw new Error("Demo user not found (founder@invoiceping.dev)");

    // Pull OPEN invoices (Stripe pagination)
    let startingAfter: string | undefined = undefined;
    let invoicesUpserted = 0;

    while (true) {
      const page = await stripe.invoices.list({
        status: "open",
        limit: 100,
        starting_after: startingAfter,
        expand: ["data.customer"],
      });

      for (const inv of page.data) {
        const dueDate = toDateFromUnixSeconds(inv.due_date);
        const paidAt = toDateFromUnixSeconds(
          (inv as any)?.status_transitions?.paid_at,
        );

        const customerObj =
          typeof inv.customer === "object" && inv.customer !== null
            ? (inv.customer as any)
            : null;

        const customerEmail = inv.customer_email ?? customerObj?.email ?? null;
        const customerName = inv.customer_name ?? customerObj?.name ?? null;

        const amountDue =
          typeof inv.amount_due === "number"
            ? BigInt(inv.amount_due)
            : BigInt(0);

        const overdue = Boolean(
          dueDate && dueDate < now && inv.status === "open",
        );

        const existing = await prisma.invoice.findUnique({
          where: {
            userId_stripeInvoiceId: {
              userId: user.id,
              stripeInvoiceId: inv.id,
            },
          },
        });

        const firstSeenOverdueAt = overdue
          ? (existing?.firstSeenOverdueAt ?? now)
          : null;

        let nextReminderDueAt: Date | null =
          existing?.nextReminderDueAt ?? null;

        // Day 6: schedule first reminder for day 3 after becoming overdue
        if (
          overdue &&
          (existing?.reminderStep ?? 0) === 0 &&
          !(existing?.remindersPaused ?? false)
        ) {
          const base = firstSeenOverdueAt ?? now;
          const scheduled = addDays(base, 3);
          nextReminderDueAt = scheduled < now ? now : scheduled;
        }

        await prisma.invoice.upsert({
          where: {
            userId_stripeInvoiceId: {
              userId: user.id,
              stripeInvoiceId: inv.id,
            },
          },
          create: {
            userId: user.id,
            stripeInvoiceId: inv.id,
            stripeCustomerId:
              typeof inv.customer === "string"
                ? inv.customer
                : (inv.customer?.id ?? null),

            customerName,
            customerEmail,

            currency: inv.currency ?? "usd",
            amountDue,
            hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
            status: inv.status ?? "open",
            dueDate,
            paidAt,

            firstSeenOverdueAt,
            reminderStep: 0,
            lastReminderSentAt: null,
            nextReminderDueAt,
            remindersPaused: false,

            lastSyncedAt: now,
          },
          update: {
            stripeCustomerId:
              typeof inv.customer === "string"
                ? inv.customer
                : (inv.customer?.id ?? existing?.stripeCustomerId ?? null),

            customerName,
            customerEmail,

            currency: inv.currency ?? existing?.currency ?? "usd",
            amountDue,
            hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
            status: inv.status ?? existing?.status ?? "open",
            dueDate,
            paidAt,

            firstSeenOverdueAt,
            nextReminderDueAt,
            lastSyncedAt: now,
          },
        });

        invoicesUpserted += 1;
      }

      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1]!.id;
    }

    return {
      invoicesUpserted,
    };
  },
});
