import { schedules } from "@trigger.dev/sdk";
import { prisma } from "../app/(database)/lib/prisma";

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

/**
 * With @@unique([invoiceId, step]) on ReminderEvent:
 * - create() can throw P2002 and Prisma will log "prisma:error" even if caught.
 * - createMany({ skipDuplicates: true }) avoids P2002 entirely (quiet + idempotent).
 */
async function createReminderEventOnce(data: {
  userId: string;
  invoiceId: string;
  stripeInvoiceId: string;
  step: number;
  toEmail: string;
  subject: string;
  status: "sending" | "sent" | "failed" | "skipped";
  error?: string | null;
  providerMessageId?: string | null;
  sentAt?: Date;
}) {
  await prisma.reminderEvent.createMany({
    data: [
      {
        userId: data.userId,
        invoiceId: data.invoiceId,
        stripeInvoiceId: data.stripeInvoiceId,
        step: data.step,
        toEmail: data.toEmail,
        subject: data.subject,
        status: data.status,
        error: data.error ?? null,
        providerMessageId: data.providerMessageId ?? null,
        sentAt: data.sentAt ?? new Date(),
      },
    ],
    skipDuplicates: true,
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
  if (!from) {
    throw new Error(
      "Missing EMAIL_FROM in env (e.g. 'InvoicePing <noreply@yourdomain.com>')",
    );
  }

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
  // cron: "*/10 * * * *",
  cron: "* * * * *",
  run: async () => {
    const now = new Date();

    const dueInvoices = await prisma.invoice.findMany({
      where: {
        nextReminderDueAt: { lte: now },
        // Efficiency: paused invoices don't even show up
        remindersPaused: false,
        reminderStep: { lt: 3 },
        status: "open",
        paidAt: null,
      },
      include: {
        user: { include: { subscription: true } },
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

      // Defensive: in case coarse filter changes later
      if (inv.remindersPaused) {
        skipped += 1;
        continue;
      }

      const user = inv.user;

      const settings = await prisma.userSettings.findUnique({
        where: { userId: user.id },
      });

      if (settings && settings.remindersEnabled === false) {
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

      const nextStep = (inv.reminderStep ?? 0) + 1;
      if (nextStep < 1 || nextStep > 3) {
        skipped += 1;
        continue;
      }

      const toEmail = (inv.customerEmail || "").trim();
      if (!toEmail) {
        await createReminderEventOnce({
          userId: user.id,
          invoiceId: inv.id,
          stripeInvoiceId: inv.stripeInvoiceId,
          step: nextStep,
          toEmail: "",
          subject: "",
          status: "skipped",
          error: "Missing customer email on invoice",
          sentAt: now,
        });

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
        await createReminderEventOnce({
          userId: user.id,
          invoiceId: inv.id,
          stripeInvoiceId: inv.stripeInvoiceId,
          step: nextStep,
          toEmail,
          subject: "",
          status: "failed",
          error: `Missing EmailTemplate for step ${nextStep}`,
          sentAt: now,
        });

        failed += 1;
        continue;
      }

      const businessName =
        (settings?.businessName ?? "").trim() || "InvoicePing";
      const defaultReplyTo =
        (process.env.DEFAULT_REPLY_TO ?? "").trim() || null;
      const replyTo = (settings?.replyToEmail ?? "").trim() || defaultReplyTo;

      const vars: TemplateVars = {
        customer_name: inv.customerName ?? "there",
        customer_email: toEmail,
        amount_due: formatMoney(inv.amountDue, inv.currency),
        currency: (inv.currency || "usd").toUpperCase(),
        hosted_invoice_url: inv.hostedInvoiceUrl ?? "",
        business_name: businessName,
        reply_to_email: replyTo ?? "",
        due_date: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : "",
      };

      const subject = renderTemplate(template.subject, vars).trim();
      const body = renderTemplate(template.body, vars).trim();

      const firstOverdue = inv.firstSeenOverdueAt ?? inv.dueDate;
      const rawNextDue = firstOverdue
        ? computeNextReminderDueAt(firstOverdue, nextStep)
        : null;

      const nextDue = rawNextDue && rawNextDue < now ? now : rawNextDue;

      // ---- Idempotent claim ----
      // If another run already created (invoiceId, step), this will no-op.
      await createReminderEventOnce({
        userId: user.id,
        invoiceId: inv.id,
        stripeInvoiceId: inv.stripeInvoiceId,
        step: nextStep,
        toEmail,
        subject,
        status: "sending",
        error: null,
        providerMessageId: null,
        sentAt: now,
      });

      // Fetch the claim row; if it's already sent/failed, do not re-send.
      const claim = await prisma.reminderEvent.findUnique({
        where: { invoiceId_step: { invoiceId: inv.id, step: nextStep } },
        select: { id: true, status: true },
      });

      if (!claim) {
        failed += 1;
        continue;
      }

      if (claim.status !== "sending") {
        skipped += 1;
        continue;
      }

      try {
        const resp = await sendEmailWithResend({
          to: toEmail,
          subject,
          text: body,
          replyTo,
        });

        await prisma.$transaction([
          prisma.reminderEvent.update({
            where: { id: claim.id },
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
        await prisma.reminderEvent.update({
          where: { id: claim.id },
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
