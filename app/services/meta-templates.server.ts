// Automates WhatsApp template creation + approval status checks via Meta's
// Graph API, so merchants submit templates from inside this app instead of
// Meta Business Manager's UI directly.
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/create-message-templates

const GRAPH_VERSION = "v19.0";

function metaHeaders() {
  return {
    Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// Converts our {tag} placeholders into Meta's positional {{1}}, {{2}}, ...
// syntax, in the order they first appear, and returns that ordered list of
// tag names alongside the converted body text.
export function convertToMetaPlaceholders(body: string): {
  metaBody: string;
  variableKeys: string[];
} {
  const seen: string[] = [];
  const metaBody = body.replace(/\{([a-z_]+)\}/g, (match, key) => {
    let index = seen.indexOf(key);
    if (index === -1) {
      seen.push(key);
      index = seen.length - 1;
    }
    return `{{${index + 1}}}`;
  });
  return { metaBody, variableKeys: seen };
}

// Meta requires template names to be lowercase, alphanumeric + underscores.
function toMetaTemplateName(displayName: string): string {
  return (
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 512) || `template_${Date.now()}`
  );
}

// Uploads an image to Meta's Resumable Upload API to get a "header handle" —
// required when submitting a template whose header is an image. This is a
// separate flow from sending a regular message with an image link; template
// headers specifically need this handle at submission time.
// Docs: https://developers.facebook.com/docs/graph-api/guides/upload
async function getMetaHeaderHandle(imageUrl: string): Promise<string | null> {
  const appId = process.env.WHATSAPP_APP_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!appId || !accessToken) {
    console.error("WHATSAPP_APP_ID not set — required for image template headers");
    return null;
  }

  try {
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) return null;
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const contentType = imageRes.headers.get("content-type") || "image/jpeg";

    const sessionRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${appId}/uploads?file_length=${buffer.length}&file_type=${encodeURIComponent(contentType)}&access_token=${accessToken}`,
      { method: "POST" },
    );
    const sessionData = await sessionRes.json();
    if (!sessionRes.ok || !sessionData.id) {
      console.error("Meta upload session creation failed", sessionData);
      return null;
    }

    const uploadRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${sessionData.id}`,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_offset: "0",
        },
        body: buffer,
      },
    );
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData.h) {
      console.error("Meta file upload failed", uploadData);
      return null;
    }

    return uploadData.h as string;
  } catch (err) {
    console.error("getMetaHeaderHandle failed", err);
    return null;
  }
}

export type SubmitTemplateResult =
  | { success: true; metaTemplateId: string; metaTemplateName: string; status: string }
  | { success: false; error: string };

// Submits a template to Meta for approval, including an image header if
// provided (via Meta's Resumable Upload API to get a header handle first).
export async function submitMetaTemplate(params: {
  displayName: string;
  category: "MARKETING" | "UTILITY";
  body: string;
  imageUrl?: string | null;
}): Promise<SubmitTemplateResult> {
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!businessAccountId || !process.env.WHATSAPP_ACCESS_TOKEN) {
    return { success: false, error: "WhatsApp Business Account not configured" };
  }

  const { metaBody, variableKeys } = convertToMetaPlaceholders(params.body);
  const metaTemplateName = toMetaTemplateName(params.displayName);

  const components: any[] = [];

  if (params.imageUrl) {
    const handle = await getMetaHeaderHandle(params.imageUrl);
    if (!handle) {
      return {
        success: false,
        error:
          "Couldn't upload the image to Meta for template approval. Check WHATSAPP_APP_ID is set correctly, or remove the image and submit as text-only.",
      };
    }
    components.push({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: [handle] },
    });
  }

  components.push({
    type: "BODY",
    text: metaBody,
    ...(variableKeys.length > 0 && {
      example: {
        body_text: [variableKeys.map((k) => sampleFor(k))],
      },
    }),
  });

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${businessAccountId}/message_templates`,
      {
        method: "POST",
        headers: metaHeaders(),
        body: JSON.stringify({
          name: metaTemplateName,
          language: "en_US",
          category: params.category,
          components,
        }),
      },
    );

    const data = await res.json();

    if (!res.ok) {
      const message = data?.error?.error_user_msg || data?.error?.message || "Submission failed";
      return { success: false, error: message };
    }

    return {
      success: true,
      metaTemplateId: data.id,
      metaTemplateName,
      status: (data.status || "PENDING").toLowerCase(),
    };
  } catch (err) {
    console.error("Meta template submission failed", err);
    return { success: false, error: "Network error contacting Meta" };
  }
}

export type TemplateStatusResult =
  | { success: true; status: string; rejectionReason?: string }
  | { success: false; error: string };

// Polls Meta for the current approval status of a previously submitted
// template. Call this from a "Refresh status" button in the UI, or on a
// schedule, since Meta doesn't push status updates to your app by default
// (webhook-based status updates require additional app review to receive).
export async function checkMetaTemplateStatus(
  metaTemplateId: string,
): Promise<TemplateStatusResult> {
  if (!process.env.WHATSAPP_ACCESS_TOKEN) {
    return { success: false, error: "WhatsApp not configured" };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${metaTemplateId}?fields=status,rejected_reason`,
      { headers: metaHeaders() },
    );
    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data?.error?.message || "Status check failed" };
    }

    return {
      success: true,
      status: (data.status || "pending").toLowerCase(),
      rejectionReason: data.rejected_reason !== "NONE" ? data.rejected_reason : undefined,
    };
  } catch (err) {
    console.error("Meta status check failed", err);
    return { success: false, error: "Network error contacting Meta" };
  }
}

function sampleFor(key: string): string {
  const samples: Record<string, string> = {
    first_name: "Rahul",
    last_name: "Sharma",
    order_id: "1023",
    order_number: "#1023",
    order_date: "11 Jul 2026",
    order_url: "https://yourstore.com/orders/1023",
    order_total: "999",
    tracking_number: "TRK123456789",
    tracking_company: "Delhivery",
    tracking_url: "https://track.delhivery.com/TRK123456789",
  };
  return samples[key] ?? "value";
}
