import { NextResponse } from "next/server";
import prisma from "@/app/(database)/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";

export async function POST(req: Request) {
  const { userId: clerkUserId } = auth();
  if (!clerkUserId) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await req.json();
  const enabled = Boolean(body.enabled);

  // Fetch clerk user for email/name (optional but useful)
  const cu = await currentUser();

  const primaryEmail =
    cu?.emailAddresses?.find((e) => e.id === cu.primaryEmailAddressId)
      ?.emailAddress ??
    cu?.emailAddresses?.[0]?.emailAddress ??
    null;

  const fullName =
    [cu?.firstName, cu?.lastName].filter(Boolean).join(" ").trim() || null;

  // 1) Find or create internal User row
  // IMPORTANT: replace `clerkUserId` field name if your User table calls it differently
  const user = await prisma.user.upsert({
    where: { clerkUserId }, // <-- adjust if your column is named differently
    update: {
      email: primaryEmail ?? undefined,
      name: fullName ?? undefined,
    },
    create: {
      clerkUserId, // <-- adjust if needed
      email: primaryEmail ?? "", // if email is required in schema
      name: fullName ?? null,
    },
    select: { id: true },
  });

  // 2) Upsert settings using INTERNAL user.id (FK-safe)
  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: { remindersEnabled: enabled },
    create: {
      userId: user.id,
      remindersEnabled: enabled,
    },
    select: { userId: true, remindersEnabled: true },
  });

  return NextResponse.json({ ok: true, settings });
}
