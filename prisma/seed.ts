import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Prisma } from "../app/generated/prisma/client";


const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL, // make sure this exists in .env
});

const prisma = new PrismaClient({ adapter });

/**
 * InvoicePing MVP rules:
 * - Follow-up schedule: day 3, 7, 14 after "firstSeenOverdueAt"
 * - reminderStep: 0 none sent, 1 sent, 2 sent, 3 sent
 * - nextReminderDueAt:
 *    step 0 => overdueAt + 3d
 *    step 1 => overdueAt + 7d
 *    step 2 => overdueAt + 14d
 *    step 3 => null
 */

const DAYS = (n: number) => n * 24 * 60 * 60 * 1000;

function computeNextReminderDueAt(firstSeenOverdueAt: Date, reminderStep: number) {
  if (reminderStep <= 0) return new Date(firstSeenOverdueAt.getTime() + DAYS(3));
  if (reminderStep === 1) return new Date(firstSeenOverdueAt.getTime() + DAYS(7));
  if (reminderStep === 2) return new Date(firstSeenOverdueAt.getTime() + DAYS(14));
  return null;
}

// Simple template variables your app can later replace when sending:
const TEMPLATE_VARS_HELP = `Available variables:
{{customer_name}}, {{customer_email}}, {{amount_due}}, {{currency}}, {{hosted_invoice_url}}`;

function defaultTemplates(businessName: string) {
  return [
    {
      step: 1,
      subject: "Quick reminder: invoice is overdue",
      body:
        `Hi {{customer_name}},\n\n` +
        `Just a quick nudge — your invoice is now overdue. You can pay here:\n{{hosted_invoice_url}}\n\n` +
        `If you’ve already taken care of it, please ignore this.\n\n` +
        `Thanks,\n${businessName}\n\n---\n${TEMPLATE_VARS_HELP}\n`,
    },
    {
      step: 2,
      subject: "Following up: invoice still unpaid",
      body:
        `Hi {{customer_name}},\n\n` +
        `Following up on the overdue invoice. Here’s the payment link again:\n{{hosted_invoice_url}}\n\n` +
        `If there’s anything blocking payment, just reply and let us know.\n\n` +
        `Thanks,\n${businessName}\n\n---\n${TEMPLATE_VARS_HELP}\n`,
    },
    {
      step: 3,
      subject: "Final reminder: invoice payment needed",
      body:
        `Hi {{customer_name}},\n\n` +
        `This is a final reminder that the invoice is still unpaid. Please complete payment here:\n{{hosted_invoice_url}}\n\n` +
        `If payment has already been made, you can ignore this message.\n\n` +
        `Regards,\n${businessName}\n\n---\n${TEMPLATE_VARS_HELP}\n`,
    },
  ];
}

async function upsertDefaultTemplates(userId: string, businessName: string) {
  const templates = defaultTemplates(businessName);

  for (const t of templates) {
    await prisma.emailTemplate.upsert({
      where: { userId_step: { userId, step: t.step } },
      // If you want seed to NEVER overwrite a user-edited template, use update: {}
      update: { subject: t.subject, body: t.body },
      create: { userId, step: t.step, subject: t.subject, body: t.body },
    });
  }
}

async function seedDemoInvoices(userId: string) {
  const now = new Date();

  // Overdue invoice first seen overdue 10 days ago (so step 2 is due at day 14)
  const overdueA_firstSeen = new Date(now.getTime() - DAYS(10));
  const overdueA_step = 1; // already sent step 1
  const overdueA_next = computeNextReminderDueAt(overdueA_firstSeen, overdueA_step);

  // Overdue invoice first seen overdue 4 days ago (step 1 due at day 3; already should have been sent, but seed shows it pending)
  const overdueB_firstSeen = new Date(now.getTime() - DAYS(4));
  const overdueB_step = 0; // none sent yet
  const overdueB_next = computeNextReminderDueAt(overdueB_firstSeen, overdueB_step);

  // Paid invoice (should not be queued)
  const paidAt = new Date(now.getTime() - DAYS(2));

  // Use deterministic Stripe IDs for idempotency
  const invoices : Prisma.InvoiceUpsertArgs[] = [
    {
      where: { userId_stripeInvoiceId: { userId, stripeInvoiceId: "in_seed_overdue_001" } },
      update: {
        status: "open",
        currency: "usd",
        amountDue: BigInt(120000), // $1200.00
        customerName: "Bluewave Studio",
        customerEmail: "ap@bluewave.studio",
        hostedInvoiceUrl: "https://invoice.stripe.com/i/in_seed_overdue_001",
        dueDate: new Date(now.getTime() - DAYS(12)),
        paidAt: null,
        firstSeenOverdueAt: overdueA_firstSeen,
        reminderStep: overdueA_step,
        lastReminderSentAt: new Date(now.getTime() - DAYS(6)),
        nextReminderDueAt: overdueA_next,
        remindersPaused: false,
        lastSyncedAt: now,
      },
      create: {
        userId,
        stripeInvoiceId: "in_seed_overdue_001",
        stripeCustomerId: "cus_seed_001",
        customerName: "Bluewave Studio",
        customerEmail: "ap@bluewave.studio",
        currency: "usd",
        amountDue: BigInt(120000),
        hostedInvoiceUrl: "https://invoice.stripe.com/i/in_seed_overdue_001",
        status: "open",
        dueDate: new Date(now.getTime() - DAYS(12)),
        paidAt: null,
        firstSeenOverdueAt: overdueA_firstSeen,
        reminderStep: overdueA_step,
        lastReminderSentAt: new Date(now.getTime() - DAYS(6)),
        nextReminderDueAt: overdueA_next,
        remindersPaused: false,
        lastSyncedAt: now,
      },
    },
    {
      where: { userId_stripeInvoiceId: { userId, stripeInvoiceId: "in_seed_overdue_002" } },
      update: {
        status: "open",
        currency: "usd",
        amountDue: BigInt(45000), // $450.00
        customerName: "Northpeak Media",
        customerEmail: "billing@northpeak.media",
        hostedInvoiceUrl: "https://invoice.stripe.com/i/in_seed_overdue_002",
        dueDate: new Date(now.getTime() - DAYS(5)),
        paidAt: null,
        firstSeenOverdueAt: overdueB_firstSeen,
        reminderStep: overdueB_step,
        lastReminderSentAt: null,
        nextReminderDueAt: overdueB_next,
        remindersPaused: false,
        lastSyncedAt: now,
      },
      create: {
        userId,
        stripeInvoiceId: "in_seed_overdue_002",
        stripeCustomerId: "cus_seed_002",
        customerName: "Northpeak Media",
        customerEmail: "billing@northpeak.media",
        currency: "usd",
        amountDue: BigInt(45000),
        hostedInvoiceUrl: "https://invoice.stripe.com/i/in_seed_overdue_002",
        status: "open",
        dueDate: new Date(now.getTime() - DAYS(5)),
        paidAt: null,
        firstSeenOverdueAt: overdueB_firstSeen,
        reminderStep: overdueB_step,
        lastReminderSentAt: null,
        nextReminderDueAt: overdueB_next,
        remindersPaused: false,
        lastSyncedAt: now,
      },
    },
    {
      where: { userId_stripeInvoiceId: { userId, stripeInvoiceId: "in_seed_paid_001" } },
      update: {
        status: "paid",
        currency: "usd",
        amountDue: BigInt(0),
        customerName: "Cedar & Co.",
        customerEmail: "finance@cedarco.com",
        hostedInvoiceUrl: "https://invoice.stripe.com/i/in_seed_paid_001",
        dueDate: new Date(now.getTime() - DAYS(8)),
        paidAt,
        firstSeenOverdueAt: new Date(now.getTime() - DAYS(7)),
        reminderStep: 0,
        lastReminderSentAt: null,
        nextReminderDueAt: null,
        remindersPaused: false,
        lastSyncedAt: now,
      },
      create: {
        userId,
        stripeInvoiceId: "in_seed_paid_001",
        stripeCustomerId: "cus_seed_003",
        customerName: "Cedar & Co.",
        customerEmail: "finance@cedarco.com",
        currency: "usd",
        amountDue: BigInt(0),
        hostedInvoiceUrl: "https://invoice.stripe.com/i/in_seed_paid_001",
        status: "paid",
        dueDate: new Date(now.getTime() - DAYS(8)),
        paidAt,
        firstSeenOverdueAt: new Date(now.getTime() - DAYS(7)),
        reminderStep: 0,
        lastReminderSentAt: null,
        nextReminderDueAt: null,
        remindersPaused: false,
        lastSyncedAt: now,
      },
    },
  ];

const createdInvoices = await Promise.all(invoices.map((inv) => prisma.invoice.upsert(inv)));
  
  // Add audit trail examples (ReminderEvent) for first overdue invoice if not present
const overdueA = createdInvoices.find((i) => i.stripeInvoiceId === "in_seed_overdue_001");
if (overdueA) {
  // Check if the event already exists (idempotent without hardcoding id)
  const existing = await prisma.reminderEvent.findFirst({
    where: {
      invoiceId: overdueA.id,
      step: 1,
      status: "sent",
    },
  });

  if (!existing) {
    await prisma.reminderEvent.create({
      data: {
        userId,
        invoiceId: overdueA.id,
        stripeInvoiceId: overdueA.stripeInvoiceId,
        step: 1,
        toEmail: overdueA.customerEmail ?? "unknown@example.com",
        subject: "Quick reminder: invoice is overdue",
        status: "sent",
        providerMessageId: "seed-msg-001",
        error: null,
      },
    });
  }
}

}

async function main() {
  /**
   * DEMO AGENCY USER for local/dev:
   * This makes it easy to demo “connect Stripe + see overdue invoices + cron picks nextReminderDueAt”
   */
  const demoEmail = "founder@invoiceping.dev";

  const user = await prisma.user.upsert({
    where: { email: demoEmail },
    update: {},
    create: {
      email: demoEmail,
      name: "InvoicePing Demo Founder",
    },
  });

  // Ensure settings exist
  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      businessName: "InvoicePing Agency",
      replyToEmail: "hello@invoiceping.dev",
      remindersEnabled: true,
      timezone: "UTC",
    },
  });

  // Ensure subscription is active (your cron will gate on this)
  await prisma.subscription.upsert({
    where: { userId: user.id },
    update: { status: "active" },
    create: {
      userId: user.id,
      status: "active",
      cancelAtPeriodEnd: false,
    },
  });

  // Ensure Stripe connection exists (fake tokens; livemode=false)
  await prisma.stripeConnection.upsert({
    where: { userId: user.id },
    update: { revokedAt: null, livemode: false },
    create: {
      userId: user.id,
      stripeAccountId: "acct_seed_invoiceping_001",
      accessTokenEnc: "enc_seed_access_token",
      refreshTokenEnc: "enc_seed_refresh_token",
      scope: "read_write",
      tokenType: "bearer",
      livemode: false,
      connectedAt: new Date(),
    },
  });

  // Default templates (steps 1-3)
  await upsertDefaultTemplates(user.id, settings.businessName ?? "InvoicePing");

  // Demo invoices + audit events
  await seedDemoInvoices(user.id);

  console.log("✅ InvoicePing seed complete");
  console.log("Demo login/user:", { email: demoEmail, userId: user.id });
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
