import { prisma } from "@/app/(database)/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import TemplatesEditor from "./templates-editor";

export default async function TemplatesPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto py-10">
        <h1 className="text-2xl font-semibold mb-2">Email Templates</h1>
        <p className="text-sm text-gray-600">
          No user record found. (Your app should create a User row on first
          sign-in.)
        </p>
      </div>
    );
  }

  const [templates, settings] = await Promise.all([
    prisma.emailTemplate.findMany({
      where: { userId: user.id },
      orderBy: { step: "asc" },
    }),
    prisma.userSettings.findUnique({
      where: { userId: user.id },
    }),
  ]);

  return (
    <div className="max-w-3xl mx-auto py-10">
      <h1 className="text-2xl font-semibold mb-6">Email Templates</h1>

      <TemplatesEditor templates={templates} settings={settings} />
    </div>
  );
}
