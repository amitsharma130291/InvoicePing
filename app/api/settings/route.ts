import { prisma } from "@/app/(database)/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

async function getInternalUserId(clerkUserId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await getInternalUserId(clerkUserId);
  if (!userId)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });

  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await getInternalUserId(clerkUserId);
  if (!userId)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const data = await req.json().catch(() => null);

  const businessName =
    data?.businessName === null
      ? null
      : String(data?.businessName ?? "").trim();
  const replyToEmail =
    data?.replyToEmail === null
      ? null
      : String(data?.replyToEmail ?? "").trim();
  const remindersEnabled = Boolean(data?.remindersEnabled);

  // basic validation (minimal)
  if (replyToEmail && !replyToEmail.includes("@")) {
    return NextResponse.json(
      { error: "Reply-to email looks invalid" },
      { status: 400 },
    );
  }

  const saved = await prisma.userSettings.upsert({
    where: { userId },
    update: {
      businessName: businessName || null,
      replyToEmail: replyToEmail || null,
      remindersEnabled,
    },
    create: {
      userId,
      businessName: businessName || null,
      replyToEmail: replyToEmail || null,
      remindersEnabled,
    },
  });

  return NextResponse.json(saved);
}
