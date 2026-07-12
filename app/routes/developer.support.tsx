import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useSearchParams } from "@remix-run/react";
import prisma from "~/db.server";

function checkAuth(request: Request): boolean {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  return Boolean(process.env.DEVELOPER_SUPPORT_SECRET) && key === process.env.DEVELOPER_SUPPORT_SECRET;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!checkAuth(request)) {
    throw new Response("Unauthorized — add ?key=YOUR_SECRET to the URL", { status: 401 });
  }

  const url = new URL(request.url);
  const selectedShopId = url.searchParams.get("shop");

  const shops = await prisma.shop.findMany({
    include: {
      supportMessages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: {
        select: { supportMessages: { where: { sender: "merchant", readByDeveloper: false } } },
      },
    },
    orderBy: { installedAt: "desc" },
  });

  let thread: any[] = [];
  if (selectedShopId) {
    await prisma.supportMessage.updateMany({
      where: { shopId: selectedShopId, sender: "merchant", readByDeveloper: false },
      data: { readByDeveloper: true },
    });
    thread = await prisma.supportMessage.findMany({
      where: { shopId: selectedShopId },
      orderBy: { createdAt: "asc" },
    });
  }

  return json({
    shops: shops.map((s) => ({
      id: s.id,
      shopDomain: s.shopDomain,
      unreadCount: s._count.supportMessages,
      lastMessage: s.supportMessages[0]?.body ?? null,
    })),
    thread: thread.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    selectedShopId,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (!checkAuth(request)) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const formData = await request.formData();
  const shopId = String(formData.get("shopId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return json({ error: "Message can't be empty" }, { status: 400 });

  await prisma.supportMessage.create({ data: { shopId, sender: "developer", body } });

  return json({ success: true });
}

export default function DeveloperSupport() {
  const { shops, thread, selectedShopId } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const key = searchParams.get("key");

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
      <div style={{ width: 300, borderRight: "1px solid #ddd", overflowY: "auto" }}>
        <h3 style={{ padding: 16 }}>Shops</h3>
        {shops.map((s) => (
          <a
            key={s.id}
            href={`?key=${key}&shop=${s.id}`}
            style={{
              display: "block",
              padding: "12px 16px",
              textDecoration: "none",
              color: "#202223",
              background: s.id === selectedShopId ? "#f1f8f5" : "transparent",
              borderBottom: "1px solid #eee",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {s.shopDomain} {s.unreadCount > 0 && <span style={{ color: "#d82c0d" }}>({s.unreadCount})</span>}
            </div>
            <div style={{ fontSize: 13, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.lastMessage || "No messages yet"}
            </div>
          </a>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {selectedShopId ? (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {thread.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.sender === "developer" ? "flex-end" : "flex-start",
                    maxWidth: "60%",
                    background: m.sender === "developer" ? "#008060" : "#fff",
                    color: m.sender === "developer" ? "#fff" : "#202223",
                    border: m.sender === "developer" ? "none" : "1px solid #e1e3e5",
                    borderRadius: 12,
                    padding: "8px 12px",
                  }}
                >
                  {m.body}
                </div>
              ))}
            </div>
            <Form method="post" style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #ddd" }}>
              <input type="hidden" name="shopId" value={selectedShopId} />
              <input
                name="body"
                placeholder="Reply..."
                style={{ flex: 1, padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
              />
              <button type="submit" style={{ padding: "10px 20px", background: "#008060", color: "#fff", border: "none", borderRadius: 8 }}>
                Send
              </button>
            </Form>
          </>
        ) : (
          <div style={{ padding: 16, color: "#666" }}>Select a shop to view its support thread.</div>
        )}
      </div>
    </div>
  );
}
