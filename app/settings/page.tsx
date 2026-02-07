import { PauseRemindersToggle } from "./PauseRemindersToggle";
import { prisma } from "@/app/(database)/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import SettingsForm from "./settings-form";

export default async function SettingsPage() {
  const { userId: clerkUserId } = await auth();
  console.log("auth userId:", clerkUserId);
  if (!clerkUserId) return null;

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto py-10">
        <h1 className="text-2xl font-semibold mb-2">Settings</h1>
        <p className="text-sm text-gray-600">
          No user record found. (Create a User row on first sign-in.)
        </p>
      </div>
    );
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
  });

  return (
    <div className="max-w-3xl mx-auto py-10">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>
      <SettingsForm settings={settings} />
    </div>
  );
}
