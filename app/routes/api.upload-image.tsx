import type { ActionFunctionArgs } from "@remix-run/node";
import { put } from "@vercel/blob";
import { authenticate } from "~/shopify.server";

// Handles image uploads for template headers. Uses Vercel Blob storage
// (free tier: 1GB storage + bandwidth, no separate signup needed if your
// project is on Vercel — just add the Blob integration in your Vercel
// project dashboard to get a BLOB_READ_WRITE_TOKEN).
export async function action({ request }: ActionFunctionArgs) {
  try {
    await authenticate.admin(request);
  } catch (err) {
    // authenticate.admin throws a redirect Response when the session is
    // missing/expired. Returning that raw breaks the client's res.json()
    // call silently (this was the actual upload bug) — return proper JSON
    // instead so the UI can show a real error.
    console.error("Auth failed on image upload", err);
    return Response.json(
      { error: "Session expired — please reload the app and try again." },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return Response.json({ error: "File must be an image" }, { status: 400 });
  }

  // 5MB cap — plenty for a WhatsApp message image, keeps Blob usage light
  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: "Image must be under 5MB" }, { status: 400 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set");
    return Response.json(
      { error: "Image storage isn't configured yet — add the Blob integration in Vercel and set BLOB_READ_WRITE_TOKEN." },
      { status: 500 },
    );
  }

  try {
    const blob = await put(`template-images/${Date.now()}-${file.name}`, file, {
      access: "public",
    });

    return Response.json({ url: blob.url });
  } catch (err) {
    console.error("Image upload failed", err);
    return Response.json({ error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
