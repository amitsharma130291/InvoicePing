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

  const templates = await prisma.emailTemplate.findMany({
    where: { userId },
    orderBy: { step: "asc" },
  });

  return NextResponse.json(templates);
}

export async function PUT(req: Request) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await getInternalUserId(clerkUserId);
  if (!userId)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const data = await req.json().catch(() => null);
  const step = Number(data?.step);
  const subject = String(data?.subject ?? "");
  const body = String(data?.body ?? "");

  if (![1, 2, 3].includes(step)) {
    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }
  if (!subject.trim()) {
    return NextResponse.json({ error: "Subject required" }, { status: 400 });
  }
  if (!body.trim()) {
    return NextResponse.json({ error: "Body required" }, { status: 400 });
  }

  const template = await prisma.emailTemplate.upsert({
    where: { userId_step: { userId, step } },
    update: { subject, body },
    create: { userId, step, subject, body },
  });

  return NextResponse.json(template);
}
