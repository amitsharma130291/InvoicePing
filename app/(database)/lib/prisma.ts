// app/(database)/lib/prisma.ts
import type { PrismaClient as PrismaClientType } from "@prisma/client";

// (Optional but recommended for Trigger.dev local dev)
// Ensures DATABASE_URL is available when running outside Next.js.
import "dotenv/config";

function createPrismaClient(): PrismaClientType {
  // Load PrismaClient constructor (interop-safe)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const prismaMod = require("@prisma/client") as any;

  const PrismaClientCtor =
    prismaMod?.PrismaClient ??
    prismaMod?.default?.PrismaClient ??
    prismaMod?.default ??
    prismaMod;

  // Prisma 7: provide either adapter OR accelerateUrl :contentReference[oaicite:1]{index=1}
  const accelerateUrl = process.env.PRISMA_ACCELERATE_URL;

  if (accelerateUrl) {
    return new PrismaClientCtor({
      accelerateUrl,
      log:
        process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    }) as PrismaClientType;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is missing. Add it to your environment.");
  }

  // Postgres driver adapter
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaPg } = require("@prisma/adapter-pg") as any;

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClientCtor({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }) as PrismaClientType;
}

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClientType | undefined;
}

export const prisma: PrismaClientType =
  globalThis.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
