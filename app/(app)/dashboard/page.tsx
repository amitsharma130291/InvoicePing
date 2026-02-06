import { prisma } from "@/app/(database)/lib/prisma";
import { auth } from "@clerk/nextjs/server";

function startOfMonthUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}

function formatMoneyFromBigInt(cents: bigint, currency: string) {
  const value = Number(cents ?? 0n) / 100;
  return `${(currency || "USD").toUpperCase()} ${value.toFixed(2)}`;
}

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    return <div className="p-6">Not logged in</div>;
  }

  /**
   * 1️⃣ Ensure DB user + defaults exist (runs once)
   */
  const dbUser = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });

  let userIdInDb = dbUser?.id;

  if (!dbUser) {
    const createdUser = await prisma.user.create({
      data: {
        clerkUserId: userId,
        settings: {
          create: {
            remindersEnabled: true,
            businessName: "",
            replyToEmail: null,
          },
        },
        emailTemplates: {
          createMany: {
            data: [
              {
                step: 1,
                subject: "Invoice {{invoice_number}} is overdue",
                body: "Hi {{customer_name}},\n\nYour invoice for {{amount_due}} was due on {{due_date}}.\n\n{{hosted_invoice_url}}",
              },
              {
                step: 2,
                subject: "Reminder: Invoice still unpaid",
                body: "Hi {{customer_name}},\n\nThis is a reminder that your invoice for {{amount_due}} is still unpaid.\n\n{{hosted_invoice_url}}",
              },
              {
                step: 3,
                subject: "Final notice before escalation",
                body: "Hi {{customer_name}},\n\nThis is the final reminder for your unpaid invoice.\n\n{{hosted_invoice_url}}",
              },
            ],
          },
        },
      },
      select: { id: true },
    });

    userIdInDb = createdUser.id;
  }

  /**
   * 2️⃣ Dashboard metrics
   */
  const now = new Date();
  const monthStart = startOfMonthUTC(now);

  const overdueWhere = {
    userId: userIdInDb,
    status: "open",
    paidAt: null,
    remindersPaused: false,
    nextReminderDueAt: { lte: now },
  } as const;

  const [overdueCount, overdueSum, remindersSentThisMonth] = await Promise.all([
    prisma.invoice.count({ where: overdueWhere }),
    prisma.invoice.aggregate({
      where: overdueWhere,
      _sum: { amountDue: true },
    }),
    prisma.reminderEvent.count({
      where: {
        userId: userIdInDb,
        status: "sent",
        sentAt: { gte: monthStart },
      },
    }),
  ]);

  const totalOverdueCents = overdueSum._sum.amountDue ?? 0n;

  /**
   * 3️⃣ Render
   */
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border p-4">
          <div className="text-sm text-gray-500">Overdue invoices</div>
          <div className="mt-2 text-3xl font-semibold">{overdueCount}</div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-sm text-gray-500">Total overdue</div>
          <div className="mt-2 text-3xl font-semibold">
            {formatMoneyFromBigInt(totalOverdueCents, "USD")}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            (MVP shows USD formatting)
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="text-sm text-gray-500">
            Reminders sent (this month)
          </div>
          <div className="mt-2 text-3xl font-semibold">
            {remindersSentThisMonth}
          </div>
        </div>
      </div>
    </div>
  );
}
