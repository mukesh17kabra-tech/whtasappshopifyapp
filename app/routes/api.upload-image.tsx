import type { ActionFunctionArgs } from "@remix-run/node";
import { put } from "@vercel/blob";
import { authenticate } from "~/shopify.server";

// Handles image uploads for template headers. Uses Vercel Blob storage
// (free tier: 1GB storage + bandwidth, no separate signup needed if your
// project is on Vercel — just add the Blob integration in your Vercel
// project dashboard to get a BLOB_READ_WRITE_TOKEN).
export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);

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

  try {
    const blob = await put(`template-images/${Date.now()}-${file.name}`, file, {
      access: "public",
    });

    return Response.json({ url: blob.url });
  } catch (err) {
    console.error("Image upload failed", err);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
