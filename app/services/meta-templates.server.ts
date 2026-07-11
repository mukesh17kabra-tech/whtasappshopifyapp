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

export type SubmitTemplateResult =
  | { success: true; metaTemplateId: string; metaTemplateName: string; status: string }
  | { success: false; error: string };

// Submits a template to Meta for approval. Note: this supports TEXT-only
// templates automatically. Templates with an image header still need Meta's
// "sample media handle" upload flow (a separate resumable upload API), which
// isn't wired up here yet — those currently still need manual submission via
// Business Manager if you want the image to be part of the approved
// template itself, OR you can send the image via sendWhatsappCustomMessage's
// freeform path within the 24h window instead of as a template header.
export async function submitMetaTemplate(params: {
  displayName: string;
  category: "MARKETING" | "UTILITY";
  body: string;
}): Promise<SubmitTemplateResult> {
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!businessAccountId || !process.env.WHATSAPP_ACCESS_TOKEN) {
    return { success: false, error: "WhatsApp Business Account not configured" };
  }

  const { metaBody, variableKeys } = convertToMetaPlaceholders(params.body);
  const metaTemplateName = toMetaTemplateName(params.displayName);

  const components: any[] = [
    {
      type: "BODY",
      text: metaBody,
      ...(variableKeys.length > 0 && {
        example: {
          body_text: [variableKeys.map((k) => sampleFor(k))],
        },
      }),
    },
  ];

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
