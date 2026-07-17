import { Session } from "@shopify/shopify-api";
import prisma from "./db.server";

// Implements the SessionStorage interface shopify-app-remix expects, using
// our own Prisma client directly against the existing Session table —
// deliberately avoiding @shopify/shopify-app-session-storage-prisma, which
// requires Prisma 6+. This keeps us on Prisma 5 (stable, already working)
// while still getting shopify-app-remix v4's expiring-token support, which
// is what we actually needed.
//
// Offline sessions only (this app never sets useOnlineTokens: true), so
// onlineAccessInfo handling is straightforward — the flattened user fields
// below only get populated for online sessions, which we don't use, but are
// kept for schema compatibility with the original template.

function sessionToRow(session: Session) {
  return {
    id: session.id,
    shop: session.shop,
    state: session.state,
    isOnline: session.isOnline,
    scope: session.scope ?? null,
    expires: session.expires ?? null,
    accessToken: session.accessToken ?? "",
    refreshToken: session.refreshToken ?? null,
    refreshTokenExpires: session.refreshTokenExpires ?? null,
    userId: session.onlineAccessInfo?.associated_user?.id
      ? BigInt(session.onlineAccessInfo.associated_user.id)
      : null,
    firstName: session.onlineAccessInfo?.associated_user?.first_name ?? null,
    lastName: session.onlineAccessInfo?.associated_user?.last_name ?? null,
    email: session.onlineAccessInfo?.associated_user?.email ?? null,
    accountOwner: session.onlineAccessInfo?.associated_user?.account_owner ?? false,
    locale: session.onlineAccessInfo?.associated_user?.locale ?? null,
    collaborator: session.onlineAccessInfo?.associated_user?.collaborator ?? false,
    emailVerified: session.onlineAccessInfo?.associated_user?.email_verified ?? false,
  };
}

function rowToSession(row: any): Session {
  const session = new Session({
    id: row.id,
    shop: row.shop,
    state: row.state,
    isOnline: row.isOnline,
    scope: row.scope ?? undefined,
    expires: row.expires ?? undefined,
    accessToken: row.accessToken,
  });
  if (row.refreshToken) session.refreshToken = row.refreshToken;
  if (row.refreshTokenExpires) session.refreshTokenExpires = row.refreshTokenExpires;
  if (row.isOnline && row.userId) {
    session.onlineAccessInfo = {
      associated_user: {
        id: Number(row.userId),
        first_name: row.firstName ?? "",
        last_name: row.lastName ?? "",
        email: row.email ?? "",
        account_owner: row.accountOwner ?? false,
        locale: row.locale ?? "",
        collaborator: row.collaborator ?? false,
        email_verified: row.emailVerified ?? false,
      },
    } as any;
  }
  return session;
}

export class CustomPrismaSessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    try {
      const data = sessionToRow(session);
      await prisma.session.upsert({
        where: { id: session.id },
        update: data,
        create: data,
      });
      return true;
    } catch (err) {
      console.error("storeSession failed:", err);
      return false;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const row = await prisma.session.findUnique({ where: { id } });
    return row ? rowToSession(row) : undefined;
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      await prisma.session.delete({ where: { id } });
      return true;
    } catch {
      return true; // already gone — not an error for our purposes
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      await prisma.session.deleteMany({ where: { id: { in: ids } } });
      return true;
    } catch (err) {
      console.error("deleteSessions failed:", err);
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const rows = await prisma.session.findMany({ where: { shop } });
    return rows.map(rowToSession);
  }
}
