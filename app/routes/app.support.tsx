import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState, useCallback } from "react";
import { Page, Card, Text, BlockStack, InlineStack, Button, Box } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ messages: [] });

  await prisma.supportMessage.updateMany({
    where: { shopId: shop.id, sender: "developer", readByMerchant: false },
    data: { readByMerchant: true },
  });

  const messages = await prisma.supportMessage.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "asc" },
  });

  return json({
    messages: messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return json({ error: "Message can't be empty" }, { status: 400 });

  await prisma.supportMessage.create({
    data: { shopId: shop.id, sender: "merchant", body },
  });

  return json({ success: true });
}

export default function Support() {
  const { messages } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof loader>();
  const sendFetcher = useFetcher<typeof action>();
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [liveMessages, setLiveMessages] = useState(messages);

  useEffect(() => setLiveMessages(messages), [messages]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetcher.load("/app/support");
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (fetcher.data?.messages) setLiveMessages(fetcher.data.messages);
  }, [fetcher.data]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [liveMessages]);

  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    const formData = new FormData();
    formData.append("body", text);
    sendFetcher.submit(formData, { method: "post" });
    setLiveMessages((prev: any) => [
      ...prev,
      { id: `temp-${Date.now()}`, sender: "merchant", body: text, createdAt: new Date().toISOString() },
    ]);
    setText("");
  }, [text, sendFetcher]);

  return (
    <Page title="Support">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">Chat with the app developer</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Ask questions, report bugs, or request help here — replies show up in this thread.
          </Text>

          <div
            ref={scrollRef}
            style={{
              height: 400,
              overflowY: "auto",
              border: "1px solid #e1e3e5",
              borderRadius: 8,
              padding: 16,
              background: "#fafbfb",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {liveMessages.length === 0 && (
              <Text as="p" tone="subdued" alignment="center">
                No messages yet — send one below to get started.
              </Text>
            )}
            {liveMessages.map((m: any) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === "merchant" ? "flex-end" : "flex-start",
                  maxWidth: "70%",
                }}
              >
                <div
                  style={{
                    background: m.sender === "merchant" ? "#008060" : "#fff",
                    color: m.sender === "merchant" ? "#fff" : "#202223",
                    border: m.sender === "merchant" ? "none" : "1px solid #e1e3e5",
                    borderRadius: 12,
                    padding: "8px 12px",
                  }}
                >
                  <Text as="p" variant="bodyMd">{m.body}</Text>
                </div>
                <Text as="p" variant="bodySm" tone="subdued" alignment={m.sender === "merchant" ? "end" : "start"}>
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </div>
            ))}
          </div>

          <InlineStack gap="200">
            <Box width="100%">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                placeholder="Type your message..."
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #c9cccf",
                  borderRadius: 8,
                  fontSize: 14,
                }}
              />
            </Box>
            <Button variant="primary" onClick={handleSend} disabled={!text.trim()}>
              Send
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Page>
  );
}
