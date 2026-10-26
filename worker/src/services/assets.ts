/**
 * Asset (R2) helpers: upload validation, object keys, public paths.
 * Contract: docs/api-contract.md §资源（/assets/*、/api/admin/assets）.
 *
 * Validation is deliberately double: the declared Content-Type must be one of
 * the allowed image types AND the file's leading bytes must prove that same
 * type. The extension we store is derived from the verified type — the user's
 * filename is never trusted.
 */

export const ASSET_PURPOSES = ["background", "logo", "icon"] as const;
export type AssetPurpose = (typeof ASSET_PURPOSES)[number];

export function isAssetPurpose(value: unknown): value is AssetPurpose {
  return (
    typeof value === "string" &&
    (ASSET_PURPOSES as readonly string[]).includes(value)
  );
}

/** Per-purpose upload limits. */
export const MAX_ASSET_BYTES: Record<AssetPurpose, number> = {
  background: 5 * 1024 * 1024,
  logo: 1024 * 1024,
  icon: 1024 * 1024,
};

export type ImageKind = "png" | "jpg" | "webp" | "gif" | "svg" | "ico";

/** Declared Content-Type → image kind (the only accepted declarations). */
const KIND_BY_MIME: Record<string, ImageKind> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/** Verified image kind → extension used in the object key. */
const EXT_BY_KIND: Record<ImageKind, string> = {
  png: "png",
  jpg: "jpg",
  webp: "webp",
  gif: "gif",
  svg: "svg",
  ico: "ico",
};

/** Verified image kind → Content-Type served by GET /assets/*. */
const MIME_BY_KIND: Record<ImageKind, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

export const ALLOWED_UPLOAD_MIME_TYPES = Object.keys(KIND_BY_MIME);

/** Immutable caching: object keys are uuid-based and never rewritten. */
export const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Objects are keyed `assets/…` and publicly served at `/assets/{key}`. */
export const ASSET_PUBLIC_PREFIX = "/assets/";

export function mimeForExt(ext: string): string | null {
  const entry = Object.entries(EXT_BY_KIND).find(([, value]) => value === ext);
  return entry ? MIME_BY_KIND[entry[0] as ImageKind] : null;
}

/** Object key for a validated upload: `assets/{purpose}/{uuid}.{ext}`. */
export function assetObjectKey(purpose: AssetPurpose, ext: string): string {
  return `assets/${purpose}/${crypto.randomUUID()}.${ext}`;
}

/** `/assets/{key}` — the value returned to clients and stored in settings. */
export function assetPublicPath(key: string): string {
  return `${ASSET_PUBLIC_PREFIX}${key}`;
}

/**
 * Inverse of `assetPublicPath`: only local uploads are R2-backed. External
 * URLs (anything not starting with `/assets/`) return null and are never
 * deleted from the bucket.
 */
export function assetKeyFromPublicPath(value: string): string | null {
  if (!value.startsWith(ASSET_PUBLIC_PREFIX)) return null;
  const key = value.slice(ASSET_PUBLIC_PREFIX.length);
  return key || null;
}

/** Delete a replaced local asset; missing binding or errors are non-fatal. */
export async function deleteAssetByPublicPath(
  bucket: R2Bucket | undefined,
  publicPath: string,
): Promise<boolean> {
  const key = assetKeyFromPublicPath(publicPath);
  if (!key || !bucket) return false;
  try {
    await bucket.delete(key);
    return true;
  } catch (err) {
    // Cleaning up an orphan must never fail the settings write that replaced it.
    console.warn(`failed to delete replaced asset "${key}"`, err);
    return false;
  }
}

// ─── Content inspection ──────────────────────────────────────────────────────

function asciiBytes(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function startsWithBytes(
  bytes: Uint8Array,
  offset: number,
  signature: readonly number[],
): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF_SIGNATURE = asciiBytes("RIFF");
const WEBP_SIGNATURE = asciiBytes("WEBP");
const GIF87A_SIGNATURE = asciiBytes("GIF87a");
const GIF89A_SIGNATURE = asciiBytes("GIF89a");
const ICO_SIGNATURE = [0x00, 0x00, 0x01, 0x00];

/** Binary image kinds proven by their magic bytes. SVG has no magic bytes. */
export function detectBinaryImageKind(bytes: Uint8Array): ImageKind | null {
  if (startsWithBytes(bytes, 0, PNG_SIGNATURE)) return "png";
  if (startsWithBytes(bytes, 0, JPEG_SIGNATURE)) return "jpg";
  if (
    startsWithBytes(bytes, 0, RIFF_SIGNATURE) &&
    startsWithBytes(bytes, 8, WEBP_SIGNATURE)
  )
    return "webp";
  if (
    startsWithBytes(bytes, 0, GIF87A_SIGNATURE) ||
    startsWithBytes(bytes, 0, GIF89A_SIGNATURE)
  )
    return "gif";
  if (startsWithBytes(bytes, 0, ICO_SIGNATURE)) return "ico";
  return null;
}

/**
 * SVG probe: after an optional BOM and leading whitespace the document must
 * open with `<?xml` or `<svg`. This keeps an HTML page from being smuggled in
 * under `image/svg+xml` (an SVG is scriptable and is served with nosniff).
 */
export function isSvgDocument(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 1024));
  return /^\uFEFF?\s*(?:<\?xml|<svg)/i.test(head);
}

// ─── Upload validation ───────────────────────────────────────────────────────

export interface VerifiedImage {
  kind: ImageKind;
  ext: string;
  mime: string;
}

export type UploadValidation =
  | { ok: true; image: VerifiedImage }
  | { ok: false; status: 400 | 413; error: string };

function humanMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}

/**
 * Size limit error for a purpose, or null when the size is allowed. Applied to
 * the declared file size before the bytes are read and again to the received
 * bytes inside `validateImageUpload`.
 */
export function assetSizeError(
  purpose: AssetPurpose,
  size: number,
): string | null {
  const limit = MAX_ASSET_BYTES[purpose];
  if (size <= limit) return null;
  return `${purpose} image is too large: ${size} bytes exceeds the ${humanMb(limit)} limit (${limit} bytes)`;
}

/**
 * Double validation (declared Content-Type + magic bytes / SVG prefix) with a
 * purpose-aware size ceiling. Returns the image metadata to store.
 */
export function validateImageUpload(input: {
  purpose: AssetPurpose;
  contentType: string | null | undefined;
  bytes: Uint8Array;
}): UploadValidation {
  const { purpose, bytes } = input;
  const declared = (input.contentType ?? "").split(";")[0].trim().toLowerCase();

  const declaredKind = KIND_BY_MIME[declared];
  if (!declaredKind) {
    return {
      ok: false,
      status: 400,
      error: `unsupported Content-Type "${declared || "(none)"}"; allowed: ${ALLOWED_UPLOAD_MIME_TYPES.join(", ")}`,
    };
  }

  const sizeError = assetSizeError(purpose, bytes.length);
  if (sizeError) return { ok: false, status: 413, error: sizeError };

  if (bytes.length === 0) {
    return { ok: false, status: 400, error: "file is empty" };
  }

  if (declaredKind === "svg") {
    if (!isSvgDocument(bytes)) {
      return {
        ok: false,
        status: 400,
        error:
          'file content is not an SVG document: expected "<?xml" or "<svg" prefix',
      };
    }
  } else {
    const detected = detectBinaryImageKind(bytes);
    if (!detected) {
      return {
        ok: false,
        status: 400,
        error: `file content does not match Content-Type "${declared}": no ${declaredKind} signature found`,
      };
    }
    if (detected !== declaredKind) {
      return {
        ok: false,
        status: 400,
        error: `file content does not match Content-Type "${declared}": detected ${MIME_BY_KIND[detected]}`,
      };
    }
  }

  return {
    ok: true,
    image: {
      kind: declaredKind,
      ext: EXT_BY_KIND[declaredKind],
      mime: MIME_BY_KIND[declaredKind],
    },
  };
}
