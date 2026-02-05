import prismaPkg from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const { PrismaClient } = prismaPkg as unknown as { PrismaClient: any };

const globalForPrisma = globalThis as unknown as {
  prisma: any | undefined;
};

// IMPORTANT:
// Use the SAME env var you already use for Postgres.
// Common ones: POSTGRES_URL, DATABASE_URL, NEON_DATABASE_URL, SUPABASE_DATABASE_URL
const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "Missing database connection string. Set POSTGRES_URL (preferred) or DATABASE_URL.",
  );
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
export { prisma };
