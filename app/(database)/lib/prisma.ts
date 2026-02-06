import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const accelerateUrl = process.env.PRISMA_ACCELERATE_URL;

if (!accelerateUrl) {
  throw new Error("Missing PRISMA_ACCELERATE_URL in env");
}

export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    accelerateUrl,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
