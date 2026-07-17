import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  TextField,
  Button,
  Banner,
  Checkbox,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { sendTemplateToSubscriber } from "~/services/template-sender.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ subscriberCount: 0, supportEmail: null });

  const subscriberCount = await prisma.optin.count({
    where: { shopId: shop.id, optedOutAt: null, marketingConsent: true },
  });

  return json({ subscriberCount, supportEmail: shop.supportEmail });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const sendWhatsapp = formData.get("sendWhatsapp") === "true";
  const sendEmailChannel = formData.get("sendEmail") === "true";

  if (!name || !body) {
    return json({ error: "Name and message are required" }, { status: 400 });
  }
  if (!sendWhatsapp && !sendEmailChannel) {
    return json({ error: "Pick at least one channel to send on" }, { status: 400 });
  }
  if (sendEmailChannel && !subject) {
    return json({ error: "Email subject is required when sending via email" }, { status: 400 });
  }
  if (sendEmailChannel && !shop.supportEmail) {
    return json(
      { error: "Add your email address in Popup Settings first — it's used as the Reply-To so customer replies reach you." },
      { status: 400 },
    );
  }

  const channel = sendWhatsapp && sendEmailChannel ? "both" : sendWhatsapp ? "whatsapp" : "email";

  const template = await prisma.template.create({
    data: { shopId: shop.id, name, body, category: "MARKETING", channel, subject: subject || null, status: "active" },
  });

  const subscribers = await prisma.optin.findMany({
    where: { shopId: shop.id, optedOutAt: null, marketingConsent: true },
  });

  let sentCount = 0;
  for (const sub of subscribers) {
    const result = await sendTemplateToSubscriber(
      shop.id,
      template,
      { phoneNumber: sub.phoneNumber, email: sub.email, name: sub.name },
    );
    if (result.whatsappSent || result.emailSent) sentCount++;
  }

  return json({ success: true, sentCount, totalSubscribers: subscribers.length });
}

export default function OfferTemplate() {
  const { subscriberCount, supportEmail } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [sendWhatsapp, setSendWhatsapp] = useState(true);
  const [sendEmailChannel, setSendEmailChannel] = useState(false);

  const isSending = navigation.state === "submitting";

  const handleSend = useCallback(() => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("body", body);
    formData.append("subject", subject);
    formData.append("sendWhatsapp", String(sendWhatsapp));
    formData.append("sendEmail", String(sendEmailChannel));
    submit(formData, { method: "post" });
  }, [name, body, subject, sendWhatsapp, sendEmailChannel, submit]);

  return (
    <Page title="Create Offer Template" subtitle="Sends immediately to every eligible subscriber, on whichever channel(s) you pick.">
      <BlockStack gap="400">
        {actionData && "error" in actionData && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}
        {actionData && "success" in actionData && (
          <Banner tone="success">
            Sent to {actionData.sentCount} of {actionData.totalSubscribers} subscribers.
          </Banner>
        )}

        {!supportEmail && (
          <Banner tone="warning">
            You haven't set your email address yet — add it on the Popup
            Settings page so email replies from customers reach you (it's
            used as the Reply-To address).
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <TextField label="Offer name" value={name} onChange={setName} autoComplete="off" placeholder="Diwali Flash Sale" />

            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" fontWeight="medium">Send on</Text>
              <Checkbox label="WhatsApp" checked={sendWhatsapp} onChange={setSendWhatsapp} />
              <Checkbox label="Email" checked={sendEmailChannel} onChange={setSendEmailChannel} />
            </BlockStack>

            {sendEmailChannel && (
              <TextField label="Email subject" value={subject} onChange={setSubject} autoComplete="off" placeholder="Don't miss our biggest sale!" />
            )}

            <div>
              <Text as="p" variant="bodyMd" fontWeight="medium">Message</Text>
              <div style={{ marginTop: 4 }}>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder="Hello {first_name}, our biggest sale of the year is live now!"
                  style={{
                    width: "100%", padding: "8px 12px", border: "1px solid #c9cccf",
                    borderRadius: 8, fontFamily: "inherit", fontSize: 14, resize: "vertical",
                  }}
                />
              </div>
            </div>

            <Text as="p" variant="bodySm" tone="subdued">
              This will send to {subscriberCount} eligible subscriber{subscriberCount === 1 ? "" : "s"} right away — there's no draft/schedule step.
            </Text>

            <Button
              variant="primary"
              onClick={handleSend}
              loading={isSending}
              disabled={!name || !body || (!sendWhatsapp && !sendEmailChannel)}
            >
              Send now to {subscriberCount} subscriber{subscriberCount === 1 ? "" : "s"}
            </Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
