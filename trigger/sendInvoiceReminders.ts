import { schedules } from "@trigger.dev/sdk";
import { prisma } from "../app/(database)/lib/prisma";

/**
 * Day-7 Reminder Sending Engine
 *
 * - Finds invoices where nextReminderDueAt <= now
 * - Sends step 1/2/3 emails using per-user templates
 * - Logs ReminderEvent (sent / failed / skipped)
 * - Advances reminderStep + nextReminderDueAt (day 3 / 7 / 14 from firstSeenOverdueAt)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function computeNextReminderDueAt(
  firstSeenOverdueAt: Date,
  reminderStepAfterSend: number,
) {
  // reminderStep: 0 none sent, 1 sent, 2 sent, 3 sent
  // After sending step N, reminderStep = N
  // next due is fixed at day 3/7/14 after first overdue.
  if (reminderStepAfterSend <= 0) return addDays(firstSeenOverdueAt, 3);
  if (reminderStepAfterSend === 1) return addDays(firstSeenOverdueAt, 7);
  if (reminderStepAfterSend === 2) return addDays(firstSeenOverdueAt, 14);
  return null;
}

function formatMoney(amountCents: bigint, currency: string) {
  // Plain, dependency-free formatting (good enough for MVP)
  const cents = Number(amountCents);
  const value = isFinite(cents) ? cents / 100 : 0;
  const upper = (currency || "usd").toUpperCase();
  return `${upper} ${value.toFixed(2)}`;
}

type TemplateVars = Record<string, string>;

function renderTemplate(input: string, vars: TemplateVars) {
  // Replace {{var}} occurrences.
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const k = String(key);
    return vars[k] ?? "";
  });
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
  // Run every 10 minutes (fast enough for MVP)
  cron: "*/10 * * * *",
  run: async () => {
    const now = new Date();

    // Day-7 gating: user settings + per-invoice pause
    // (Day-8 you’ll add active subscription gating)
    const dueInvoices = await prisma.invoice.findMany({
      where: {
        nextReminderDueAt: { lte: now },
        remindersPaused: false,
        reminderStep: { lt: 3 },
        status: "open",
        paidAt: null,
        user: {
          settings: {
            is: { remindersEnabled: true },
          },
        },
      },
      include: {
        user: {
          include: { settings: true },
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

      const user = inv.user;
      const settings = user.settings;

      // Next step to send
      const nextStep = (inv.reminderStep ?? 0) + 1;
      if (nextStep < 1 || nextStep > 3) continue;

      // Idempotency: do not send same step twice
      const alreadySent = await prisma.reminderEvent.findFirst({
        where: {
          userId: user.id,
          invoiceId: inv.id,
          step: nextStep,
          status: "sent",
        },
        select: { id: true },
      });

      if (alreadySent) {
        // Advance scheduling defensively so it doesn't get stuck.
        const firstOverdue = inv.firstSeenOverdueAt ?? inv.dueDate;
        const rawNextDue = firstOverdue
          ? computeNextReminderDueAt(firstOverdue, nextStep)
          : null;
        const nextDue = rawNextDue && rawNextDue < now ? now : rawNextDue;

        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            reminderStep: nextStep,
            lastReminderSentAt: inv.lastReminderSentAt ?? now,
            nextReminderDueAt: nextDue,
          },
        });

        skipped += 1;
        continue;
      }

      const toEmail = (inv.customerEmail || "").trim();
      if (!toEmail) {
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

        // Stop trying for this invoice (prevents endless retries)
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
        failed += 1;
        continue;
      }

      const vars: TemplateVars = {
        // Your seeded vars
        customer_name: inv.customerName ?? "there",
        customer_email: toEmail,
        amount_due: formatMoney(inv.amountDue, inv.currency),
        currency: (inv.currency || "usd").toUpperCase(),
        hosted_invoice_url: inv.hostedInvoiceUrl ?? "",

        // Extra vars (safe for future templates)
        business_name: settings?.businessName ?? "",
        due_date: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : "",
      };

      const subject = renderTemplate(template.subject, vars).trim();
      const body = renderTemplate(template.body, vars).trim();

      const firstOverdue = inv.firstSeenOverdueAt ?? inv.dueDate;
      const rawNextDue = firstOverdue
        ? computeNextReminderDueAt(firstOverdue, nextStep)
        : null;
      const nextDue = rawNextDue && rawNextDue < now ? now : rawNextDue;

      try {
        const resp = await sendEmailWithResend({
          to: toEmail,
          subject,
          text: body,
          replyTo: settings?.replyToEmail ?? null,
        });

        await prisma.$transaction([
          prisma.reminderEvent.create({
            data: {
              userId: user.id,
              invoiceId: inv.id,
              stripeInvoiceId: inv.stripeInvoiceId,
              step: nextStep,
              toEmail,
              subject,
              status: "sent",
              providerMessageId: resp.id ?? null,
              error: null,
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
        await prisma.reminderEvent.create({
          data: {
            userId: user.id,
            invoiceId: inv.id,
            stripeInvoiceId: inv.stripeInvoiceId,
            step: nextStep,
            toEmail,
            subject,
            status: "failed",
            error: String(err?.message ?? err),
          },
        });

        failed += 1;
      }
    }

    return { processed, sent, skipped, failed };
  },
});
