import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useSearchParams } from "@remix-run/react";
import { useState, useRef } from "react";
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
  const imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;
  if (!body && !imageUrl) return json({ error: "Message can't be empty" }, { status: 400 });

  await prisma.supportMessage.create({ data: { shopId, sender: "developer", body, imageUrl } });

  return json({ success: true });
}

export default function DeveloperSupport() {
  const { shops, thread, selectedShopId } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const key = searchParams.get("key");
  const [pendingImage, setPendingImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageSelect = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/upload-image?devKey=${key}`, { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok && data.url) setPendingImage(data.url);
    } catch {
      // ignore — merchant/developer can retry the attach
    } finally {
      setUploading(false);
    }
  };

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
              {thread.map((m: any) => (
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
                  {m.imageUrl && (
                    <img
                      src={m.imageUrl}
                      alt="attachment"
                      style={{ maxWidth: "100%", borderRadius: 6, marginBottom: m.body ? 6 : 0, display: "block", cursor: "pointer" }}
                      onClick={() => window.open(m.imageUrl, "_blank")}
                    />
                  )}
                  {m.body}
                </div>
              ))}
            </div>
            <Form
              method="post"
              style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16, borderTop: "1px solid #ddd" }}
              onSubmit={() => setTimeout(() => setPendingImage(""), 0)}
            >
              <input type="hidden" name="shopId" value={selectedShopId} />
              <input type="hidden" name="imageUrl" value={pendingImage} />
              {pendingImage && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <img src={pendingImage} alt="preview" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
                  <button type="button" onClick={() => setPendingImage("")} style={{ background: "none", border: "none", color: "#d82c0d", cursor: "pointer" }}>
                    Remove
                  </button>
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageSelect(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{ width: 40, border: "1px solid #ccc", borderRadius: 8, background: "#fff", cursor: "pointer" }}
                >
                  📎
                </button>
                <input
                  name="body"
                  placeholder="Reply..."
                  style={{ flex: 1, padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
                />
                <button type="submit" style={{ padding: "10px 20px", background: "#008060", color: "#fff", border: "none", borderRadius: 8 }}>
                  Send
                </button>
              </div>
            </Form>
          </>
        ) : (
          <div style={{ padding: 16, color: "#666" }}>Select a shop to view its support thread.</div>
        )}
      </div>
    </div>
  );
}
