import Link from "next/link";
import prisma from "@/app/(database)/lib/prisma";

type SearchParams = {
  stripe?: string;
  reason?: string;
};

// TEMP demo user helper (same as Stripe routes)
async function getUserIdOrThrow() {
  const demoEmail = "founder@invoiceping.dev";
  const user = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (!user) throw new Error("Demo user not found. Run prisma seed.");
  return user.id;
}

export default async function BillingPage(props: {
  searchParams?: Promise<SearchParams>;
}) {
  // ✅ Next.js requires awaiting searchParams (dynamic API)
  const sp = (await props.searchParams) ?? {};
  const stripeStatus = sp.stripe;
  const stripeReason = sp.reason;

  const userId = await getUserIdOrThrow();

  const stripeConnection = await prisma.stripeConnection.findUnique({
    where: { userId },
    select: {
      stripeAccountId: true,
      connectedAt: true,
      livemode: true,
    },
  });

  const isConnected = Boolean(stripeConnection?.stripeAccountId);

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
        Billing
      </h1>

      {stripeStatus === "error" && !isConnected && (
        <div
          style={{
            padding: 12,
            border: "1px solid #fca5a5",
            background: "#fef2f2",
            color: "#b91c1c",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          Stripe connection failed: <b>{stripeReason ?? "unknown_error"}</b>
        </div>
      )}

      {stripeStatus === "connected" && (
        <div
          style={{
            padding: 12,
            border: "1px solid #86efac",
            background: "#f0fdf4",
            color: "#166534",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          ✅ Stripe connected successfully
        </div>
      )}

      {isConnected ? (
        <div
          style={{
            padding: 12,
            border: "1px solid #86efac",
            background: "#f0fdf4",
            color: "#166534",
            borderRadius: 8,
          }}
        >
          <div style={{ fontWeight: 600 }}>Stripe is connected</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>
            Account: <code>{stripeConnection?.stripeAccountId}</code>
            <br />
            Mode: {stripeConnection?.livemode ? "Live" : "Test"}
            <br />
            Connected at: {stripeConnection?.connectedAt?.toISOString()}
          </div>
        </div>
      ) : (
        <div
          style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }}
        >
          <p style={{ marginBottom: 12 }}>
            Connect your Stripe account to enable billing features.
          </p>

          <Link
            href="/api/stripe/connect/start"
            style={{
              display: "inline-block",
              background: "black",
              color: "white",
              padding: "10px 14px",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            Connect Stripe
          </Link>
        </div>
      )}
    </div>
  );
}
