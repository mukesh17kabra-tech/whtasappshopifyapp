import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Required for Neon serverless driver to work outside the browser/edge runtime
neonConfig.webSocketConstructor = ws;

declare global {
  var prismaGlobal: PrismaClient;
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({ adapter });
}

// Reuse the client across hot-reloads in dev, and across warm serverless
// invocations in production, instead of opening a fresh Neon pool/websocket
// connection on every single request. Caching only in dev (checking
// NODE_ENV) was the bug here — Vercel reuses warm lambda containers across
// requests in production too, so this needs to be cached unconditionally to
// actually get that benefit.
const prisma: PrismaClient = global.prismaGlobal ?? createPrismaClient();
global.prismaGlobal = prisma;

export default prisma;