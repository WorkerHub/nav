import type { Context } from "hono";
import { Hono } from "hono";
import type { HonoEnv } from "../types";
import {
  ASSET_CACHE_CONTROL,
  ASSET_PUBLIC_PREFIX,
  assetKeyFromPublicPath,
  assetObjectKey,
  assetPublicPath,
  assetSizeError,
  isAssetPurpose,
  mimeForExt,
  validateImageUpload,
} from "../services/assets";

/**
 * Public asset surface: `GET /assets/*` streams objects back from R2.
 * Mounted in index.ts BEFORE the SPA fallback (`app.get("*")`), otherwise the
 * static-assets handler would swallow every request.
 */
export const assetPublicRoutes = new Hono<HonoEnv>();

function assetHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": ASSET_CACHE_CONTROL,
    // Uploads are user-supplied: never let a browser re-sniff (SVG → HTML).
    "X-Content-Type-Options": "nosniff",
  };
}

assetPublicRoutes.get("/*", async (c) => {
  // Local/preview environments may have no R2 binding at all: 404, never 500.
  const bucket = c.env.R2;
  if (!bucket) return c.json({ error: "not found" }, 404);

  const key = c.req.path.slice(ASSET_PUBLIC_PREFIX.length);
  if (!key || key.includes("..")) return c.json({ error: "not found" }, 404);

  const object = await bucket.get(key);
  if (!object) return c.json({ error: "not found" }, 404);

  const ext = key.split(".").pop() ?? "";
  const contentType =
    ext === "svg"
      ? "image/svg+xml"
      : (mimeForExt(ext) ?? "application/octet-stream");

  return new Response(object.body, {
    status: 200,
    headers: assetHeaders(contentType),
  });
});

// ─── Admin handlers (registered inside adminRoutes → session required) ────────

function storageUnavailable(c: Context<HonoEnv>): Response {
  return c.json(
    {
      error:
        "asset storage unavailable: the R2 binding is not configured in this environment",
    },
    503,
  );
}

function isFileLike(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).size === "number"
  );
}

/**
 * `POST /api/admin/assets` — multipart `file` + `purpose`
 * (`background` | `logo` | `icon`) → 201 `{path: "/assets/assets/{purpose}/{uuid}.{ext}"}`.
 */
export async function uploadAsset(c: Context<HonoEnv>): Promise<Response> {
  const bucket = c.env.R2;
  if (!bucket) return storageUnavailable(c);

  const body = await c.req
    .parseBody()
    .catch(() => ({}) as Record<string, string | File>);

  const purpose = body.purpose;
  if (!isAssetPurpose(purpose)) {
    return c.json(
      { error: "purpose is required and must be background, logo or icon" },
      400,
    );
  }

  const file = body.file;
  if (!isFileLike(file)) {
    return c.json({ error: "file is required (multipart field 'file')" }, 400);
  }

  const sizeError = assetSizeError(purpose, file.size);
  if (sizeError) return c.json({ error: sizeError }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateImageUpload({
    purpose,
    contentType: file.type,
    bytes,
  });
  if (!validation.ok) {
    return c.json({ error: validation.error }, validation.status);
  }

  const key = assetObjectKey(purpose, validation.image.ext);
  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: validation.image.mime,
      cacheControl: ASSET_CACHE_CONTROL,
    },
  });

  return c.json({ path: assetPublicPath(key) }, 201);
}

/** `DELETE /api/admin/assets` — body `{key}` → `{success:true}`. */
export async function deleteAsset(c: Context<HonoEnv>): Promise<Response> {
  const bucket = c.env.R2;
  if (!bucket) return storageUnavailable(c);

  const body = await c.req.json().catch(() => ({}));
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key) return c.json({ error: "key is required" }, 400);
  // Accept both the raw object key and the public path clients were handed.
  const objectKey = assetKeyFromPublicPath(key) ?? key;

  await bucket.delete(objectKey);
  return c.json({ success: true });
}
