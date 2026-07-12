import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState, useCallback } from "react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "~/shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/whatsapp-connect">Connect WhatsApp</Link>
        <Link to="/app/broadcasts">Broadcasts</Link>
        <Link to="/app/subscribers">Subscribers</Link>
        <Link to="/app/templates">Templates</Link>
        <Link to="/app/popup-settings">Popup Settings</Link>
        <Link to="/app/chatbot-settings">Chatbot Settings</Link>
        <Link to="/app/billing">Billing</Link>
      </NavMenu>
      <Outlet />
      <SupportChatBubble />
    </AppProvider>
  );
}

// Floating support chat bubble, rendered on every app page — reuses the
// same data endpoint (loader/action) as app.support.tsx, just presented as
// a bubble+panel instead of navigating to a full page.
function SupportChatBubble() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const fetcher = useFetcher<{ messages: any[] }>();
  const sendFetcher = useFetcher();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    if (!open) return;
    fetcher.load("/app/support");
    const interval = setInterval(() => fetcher.load("/app/support"), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (fetcher.data?.messages) setMessages(fetcher.data.messages);
  }, [fetcher.data]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    const formData = new FormData();
    formData.append("body", text);
    sendFetcher.submit(formData, { method: "post", action: "/app/support" });
    setMessages((prev) => [
      ...prev,
      { id: `temp-${Date.now()}`, sender: "merchant", body: text, createdAt: new Date().toISOString() },
    ]);
    setText("");
  }, [text, sendFetcher]);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "#008060",
          color: "#fff",
          border: "none",
          fontSize: 24,
          cursor: "pointer",
          boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
          zIndex: 9999,
        }}
        aria-label="Support chat"
      >
        {open ? "×" : "💬"}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 90,
            right: 24,
            width: 340,
            height: 440,
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 9999,
          }}
        >
          <div style={{ background: "#008060", color: "#fff", padding: "12px 16px", fontWeight: 600 }}>
            Support
          </div>
          <div
            ref={scrollRef}
            style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8, background: "#fafbfb" }}
          >
            {messages.length === 0 && (
              <div style={{ color: "#8a8a8a", fontSize: 13, textAlign: "center", marginTop: 20 }}>
                Ask questions, report bugs, or request help here.
              </div>
            )}
            {messages.map((m: any) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === "merchant" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  background: m.sender === "merchant" ? "#008060" : "#fff",
                  color: m.sender === "merchant" ? "#fff" : "#202223",
                  border: m.sender === "merchant" ? "none" : "1px solid #e1e3e5",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: 14,
                }}
              >
                {m.body}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #eee" }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              placeholder="Type your message..."
              style={{ flex: 1, padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 8, fontSize: 14 }}
            />
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              style={{ padding: "8px 14px", background: "#008060", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Required by Shopify to correctly handle auth-related errors/headers
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};
