import { schedules } from "@trigger.dev/sdk";
import { prisma } from "../app/(database)/lib/prisma";

/**
 * Reminder Sending Engine (Day 7 + Day 8 gates)
 *
 * Gates:
 * - UserSettings.remindersEnabled must be true (global pause/unpause)
 * - Invoice.remindersPaused must be false (invoice-level pause)
 * - Subscription must be active/trialing (and within currentPeriodEnd if set)
 *
 * Idempotency:
 * - Uses a DB-unique constraint on (invoiceId, step) to "claim" a send before emailing.
 * - If another run already claimed the same invoice+step, we skip (no crash, no double-send).
 *
 * Notes:
 * - Re-check gates inside loop to avoid accidental sends if user pauses mid-run.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function computeNextReminderDueAt(
  firstSeenOverdueAt: Date,
  reminderStepAfterSend: number,
) {
  if (reminderStepAfterSend <= 0) return addDays(firstSeenOverdueAt, 3);
  if (reminderStepAfterSend === 1) return addDays(firstSeenOverdueAt, 7);
  if (reminderStepAfterSend === 2) return addDays(firstSeenOverdueAt, 14);
  return null;
}

function formatMoney(amountCents: bigint, currency: string) {
  const cents = Number(amountCents);
  const value = isFinite(cents) ? cents / 100 : 0;
  const upper = (currency || "usd").toUpperCase();
  return `${upper} ${value.toFixed(2)}`;
}

type TemplateVars = Record<string, string>;

function renderTemplate(input: string, vars: TemplateVars) {
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const k = String(key);
    return vars[k] ?? "";
  });
}

function isUniqueConstraintError(err: any) {
  return err?.code === "P2002";
}

async function sendEmailWithResend(args: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey) throw new Error("Missing RESEND_API_KEY in env");
  if (!from)
    throw new Error(
      "Missing EMAIL_FROM in env (e.g. 'InvoicePing <noreply@yourdomain.com>')",
    );

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      text: args.text,
      reply_to: args.replyTo ?? undefined,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.message || `Resend error: HTTP ${res.status}`;
    throw new Error(msg);
  }

  return { id: (json as any)?.id as string | undefined };
}

export const sendInvoiceReminders = schedules.task({
  id: "send-invoice-reminders",
  // Keep your schedule (you can switch to "*/10 * * * *" if you truly want every 10 minutes)
  cron: "*/10 * * * *",
  run: async () => {
    const now = new Date();

    const dueInvoices = await prisma.invoice.findMany({
      where: {
        nextReminderDueAt: { lte: now },

        // ✅ invoice-level pause gate
        remindersPaused: false,

        reminderStep: { lt: 3 },
        status: "open",
        paidAt: null,

        user: {
          settings: {
            // ✅ global pause/unpause gate
            is: { remindersEnabled: true },
          },

          // ✅ subscription gate
          subscription: {
            is: {
              status: { in: ["active", "trialing"] },
              OR: [
                { currentPeriodEnd: null },
                { currentPeriodEnd: { gt: now } },
              ],
            },
          },
        },
      },
      include: {
        user: {
          include: { settings: true, subscription: true },
        },
      },
      orderBy: { nextReminderDueAt: "asc" },
      take: 50,
    });

    let processed = 0;
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const inv of dueInvoices) {
      processed += 1;

      // ✅ runtime double-check gates (prevents edge-case accidental sends)
      if (inv.remindersPaused) {
        skipped += 1;
        continue;
      }

      const user = inv.user;
      const settings = user.settings;

      if (!settings?.remindersEnabled) {
        skipped += 1;
        continue;
      }

      const sub = user.subscription;
      const subOk =
        !!sub &&
        (sub.status === "active" || sub.status === "trialing") &&
        (!sub.currentPeriodEnd || sub.currentPeriodEnd > now);

      if (!subOk) {
        skipped += 1;
        continue;
      }

      // Next step to send
      const nextStep = (inv.reminderStep ?? 0) + 1;
      if (nextStep < 1 || nextStep > 3) continue;

      const toEmail = (inv.customerEmail || "").trim();
      if (!toEmail) {
        // No email => log + stop future retries
        try {
          await prisma.reminderEvent.create({
            data: {
              userId: user.id,
              invoiceId: inv.id,
              stripeInvoiceId: inv.stripeInvoiceId,
              step: nextStep,
              toEmail: "",
              subject: "",
              status: "skipped",
              error: "Missing customer email on invoice",
            },
          });
        } catch (err: any) {
          // If another run already logged this step, ignore
          if (!isUniqueConstraintError(err)) throw err;
        }

        await prisma.invoice.update({
          where: { id: inv.id },
          data: { nextReminderDueAt: null },
        });

        skipped += 1;
        continue;
      }

      const template = await prisma.emailTemplate.findUnique({
        where: { userId_step: { userId: user.id, step: nextStep } },
      });

      if (!template) {
        // Missing template => log failure (idempotent)
        try {
          await prisma.reminderEvent.create({
            data: {
              userId: user.id,
              invoiceId: inv.id,
              stripeInvoiceId: inv.stripeInvoiceId,
              step: nextStep,
              toEmail,
              subject: "",
              status: "failed",
              error: `Missing EmailTemplate for step ${nextStep}`,
            },
          });
        } catch (err: any) {
          if (!isUniqueConstraintError(err)) throw err;
        }

        failed += 1;
        continue;
      }

      const vars: TemplateVars = {
        customer_name: inv.customerName ?? "there",
        customer_email: toEmail,
        amount_due: formatMoney(inv.amountDue, inv.currency),
        currency: (inv.currency || "usd").toUpperCase(),
        hosted_invoice_url: inv.hostedInvoiceUrl ?? "",
        business_name: settings.businessName ?? "",
        due_date: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : "",
      };

      const subject = renderTemplate(template.subject, vars).trim();
      const body = renderTemplate(template.body, vars).trim();

      const firstOverdue = inv.firstSeenOverdueAt ?? inv.dueDate;
      const rawNextDue = firstOverdue
        ? computeNextReminderDueAt(firstOverdue, nextStep)
        : null;
      const nextDue = rawNextDue && rawNextDue < now ? now : rawNextDue;

      /**
       * ✅ Idempotency "claim" (atomic)
       * Create the reminder event FIRST.
       * If it already exists (unique invoiceId+step), another run owns it -> skip.
       *
       * IMPORTANT: This relies on a unique constraint on ReminderEvent(invoiceId, step)
       * (you already have it in DB, based on the error you posted).
       */
      let claimEventId: string | null = null;
      try {
        const claim = await prisma.reminderEvent.create({
          data: {
            userId: user.id,
            invoiceId: inv.id,
            stripeInvoiceId: inv.stripeInvoiceId,
            step: nextStep,
            toEmail,
            subject,
            status: "sending", // temporary state
            error: null,
            providerMessageId: null,
            sentAt: now,
          },
          select: { id: true },
        });
        claimEventId = claim.id;
      } catch (err: any) {
        if (isUniqueConstraintError(err)) {
          // Another run already claimed/sent this step.
          skipped += 1;
          continue;
        }
        throw err;
      }

      try {
        const resp = await sendEmailWithResend({
          to: toEmail,
          subject,
          text: body,
          replyTo: settings.replyToEmail ?? null,
        });

        await prisma.$transaction([
          prisma.reminderEvent.update({
            where: { id: claimEventId },
            data: {
              status: "sent",
              providerMessageId: resp.id ?? null,
              error: null,
              sentAt: now,
            },
          }),
          prisma.invoice.update({
            where: { id: inv.id },
            data: {
              reminderStep: nextStep,
              lastReminderSentAt: now,
              nextReminderDueAt: nextDue,
            },
          }),
        ]);

        sent += 1;
      } catch (err: any) {
        // Mark the claimed event as failed (do not create a new row -> avoids unique crash)
        await prisma.reminderEvent.update({
          where: { id: claimEventId },
          data: {
            status: "failed",
            error: String(err?.message ?? err),
            sentAt: now,
          },
        });

        failed += 1;
      }
    }

    return { processed, sent, skipped, failed };
  },
});
