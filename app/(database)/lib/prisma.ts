import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neon, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Required in Node.js for Neon serverless driver
neonConfig.webSocketConstructor = ws;

// IMPORTANT: this must be a *postgresql://* Neon URL (unpooled preferred)
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Missing DATABASE_URL");

const sql = neon(connectionString);
const adapter = new PrismaNeon(sql);

export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;

export default prisma;
