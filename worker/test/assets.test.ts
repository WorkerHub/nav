import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { runMigrations } from "../src/lib/migrations-runner";
import { authRoutes } from "../src/routes/auth";
import { adminRoutes } from "../src/routes/admin";
import { assetPublicRoutes } from "../src/routes/assets";
import type { Env } from "../src/types";
import { MemoryR2, makeEnv, readJson } from "./helpers";

const SETUP_SECRET_HEADER = "x-setup-secret";
const OWNER_PASSWORD = "owner-password-1";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

const WEBP_BYTES = new Uint8Array([
  // "RIFF" + size + "WEBP"
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20,
]);

const GIF_BYTES = new Uint8Array([
  // "GIF89a"
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
]);

const ICO_BYTES = new Uint8Array([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00,
]);

const SVG_BYTES = new TextEncoder().encode(
  '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
);

/** PNG magic bytes padded to `size` so only the size check can fail. */
function pngOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_BYTES.subarray(0, Math.min(PNG_BYTES.length, size)));
  return bytes;
}

// ─── Harness ─────────────────────────────────────────────────────────────────

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/assets", assetPublicRoutes);
  return app;
}

async function signIn(app: Hono, env: Env): Promise<string> {
  const res = await app.request(
    "/api/auth/setup",
    {
      method: "POST",
      body: JSON.stringify({ username: "owner", password: OWNER_PASSWORD }),
      headers: {
        "content-type": "application/json",
        [SETUP_SECRET_HEADER]: "test-setup-secret",
      },
    },
    env,
  );
  expect(res.status).toBe(201);
  return res.headers.get("set-cookie") ?? "";
}

function upload(
  app: Hono,
  env: Env,
  cookie: string,
  bytes: Uint8Array,
  type: string,
  options: { purpose?: string; filename?: string } = {},
): Promise<Response> {
  const form = new FormData();
  if (options.purpose !== undefined) form.set("purpose", options.purpose);
  form.set(
    "file",
    new File([bytes], options.filename ?? "upload.bin", { type }),
  );
  return app.request(
    "/api/admin/assets",
    { method: "POST", body: form, headers: { cookie } },
    env,
  );
}

function putSettings(
  app: Hono,
  env: Env,
  cookie: string,
  body: unknown,
): Promise<Response> {
  return app.request(
    "/api/admin/settings",
    {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie },
    },
    env,
  );
}

const KEY_RE =
  /^\/assets\/assets\/(background|logo|icon)\/[0-9a-f-]{36}\.(png|jpg|webp|gif|svg|ico)$/;

/** `/assets/{key}` → `{key}` (the R2 object key). */
function objectKeyFromPath(publicPath: string): string {
  return publicPath.replace(/^\/assets\//, "");
}

describe("POST /api/admin/assets", () => {
  let env: Env;
  let r2: MemoryR2;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    r2 = new MemoryR2();
    env = makeEnv({ R2: r2 as unknown as R2Bucket });
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("requires a session (401 JSON)", async () => {
    const form = new FormData();
    form.set("purpose", "background");
    form.set("file", new File([PNG_BYTES], "bg.png", { type: "image/png" }));
    const res = await app.request(
      "/api/admin/assets",
      { method: "POST", body: form },
      env,
    );
    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: "unauthorized" });
    expect(r2.objects.size).toBe(0);
  });

  it("accepts a PNG and returns the frozen /assets/ + key path", async () => {
    const res = await upload(app, env, cookie, PNG_BYTES, "image/png", {
      purpose: "background",
      // Filename must never influence the stored extension.
      filename: "not-really-a-page.html",
    });
    expect(res.status).toBe(201);
    const { path } = await readJson(res);
    expect(path).toMatch(KEY_RE);
    expect(path.startsWith("/assets/assets/background/")).toBe(true);
    expect(path.endsWith(".png")).toBe(true);

    const stored = r2.objects.get(objectKeyFromPath(path));
    expect(stored).toBeTruthy();
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
    expect(stored?.httpMetadata?.cacheControl).toContain("immutable");
    expect(Array.from(stored?.bytes ?? [])).toEqual(Array.from(PNG_BYTES));
  });

  it("accepts every allowed image type with matching magic bytes", async () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ["image/jpeg", JPEG_BYTES, ".jpg"],
      ["image/webp", WEBP_BYTES, ".webp"],
      ["image/gif", GIF_BYTES, ".gif"],
      ["image/x-icon", ICO_BYTES, ".ico"],
      ["image/svg+xml", SVG_BYTES, ".svg"],
    ];
    for (const [type, bytes, ext] of cases) {
      const res = await upload(app, env, cookie, bytes, type, {
        purpose: "icon",
      });
      expect(res.status, `${type} should be accepted`).toBe(201);
      const { path } = await readJson(res);
      expect(path.endsWith(ext)).toBe(true);
      expect(path.startsWith("/assets/assets/icon/")).toBe(true);
    }
  });

  it("rejects a Content-Type/magic-byte mismatch", async () => {
    const res = await upload(app, env, cookie, JPEG_BYTES, "image/png", {
      purpose: "background",
    });
    expect(res.status).toBe(400);
    const { error } = await readJson(res);
    expect(error).toContain("does not match");
    expect(error).toContain("image/jpeg");
    expect(r2.objects.size).toBe(0);
  });

  it("rejects a disallowed Content-Type", async () => {
    const res = await upload(app, env, cookie, PNG_BYTES, "image/bmp", {
      purpose: "background",
    });
    expect(res.status).toBe(400);
    const { error } = await readJson(res);
    expect(error).toContain("unsupported Content-Type");
    expect(error).toContain("image/png");
    expect(r2.objects.size).toBe(0);
  });

  it("rejects an SVG Content-Type carrying HTML instead of SVG", async () => {
    const html = new TextEncoder().encode(
      "<html><script>alert(1)</script></html>",
    );
    const res = await upload(app, env, cookie, html, "image/svg+xml", {
      purpose: "logo",
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toContain("not an SVG document");
    expect(r2.objects.size).toBe(0);
  });

  it("accepts an SVG behind a BOM and leading whitespace", async () => {
    const bytes = new TextEncoder().encode(
      '\uFEFF\n  <svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
    );
    const res = await upload(app, env, cookie, bytes, "image/svg+xml", {
      purpose: "logo",
    });
    expect(res.status).toBe(201);
    expect((await readJson(res)).path.endsWith(".svg")).toBe(true);
  });

  it("rejects a missing or unknown purpose", async () => {
    const missing = await upload(app, env, cookie, PNG_BYTES, "image/png");
    expect(missing.status).toBe(400);
    expect((await readJson(missing)).error).toContain("purpose");

    const unknown = await upload(app, env, cookie, PNG_BYTES, "image/png", {
      purpose: "avatar",
    });
    expect(unknown.status).toBe(400);
    expect((await readJson(unknown)).error).toContain(
      "background, logo or icon",
    );
    expect(r2.objects.size).toBe(0);
  });

  it("rejects a missing file field", async () => {
    const form = new FormData();
    form.set("purpose", "background");
    const res = await app.request(
      "/api/admin/assets",
      { method: "POST", body: form, headers: { cookie } },
      env,
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toContain("file is required");
  });

  it("enforces 1MB for logo/icon and 5MB for background", async () => {
    const oneMb = 1024 * 1024;
    const fiveMb = 5 * 1024 * 1024;

    const logoTooBig = await upload(
      app,
      env,
      cookie,
      pngOfSize(oneMb + 1),
      "image/png",
      { purpose: "logo" },
    );
    expect(logoTooBig.status).toBe(413);
    const logoError = (await readJson(logoTooBig)).error;
    expect(logoError).toContain("logo image is too large");
    expect(logoError).toContain("1MB");
    expect(logoError).toContain(String(oneMb));

    const iconOk = await upload(
      app,
      env,
      cookie,
      pngOfSize(oneMb),
      "image/png",
      { purpose: "icon" },
    );
    expect(iconOk.status).toBe(201);

    // 1.5MB is fine for a background but not for a logo.
    const bgOk = await upload(
      app,
      env,
      cookie,
      pngOfSize(oneMb + 512 * 1024),
      "image/png",
      { purpose: "background" },
    );
    expect(bgOk.status).toBe(201);

    const bgTooBig = await upload(
      app,
      env,
      cookie,
      pngOfSize(fiveMb + 1),
      "image/png",
      { purpose: "background" },
    );
    expect(bgTooBig.status).toBe(413);
    const bgError = (await readJson(bgTooBig)).error;
    expect(bgError).toContain("background image is too large");
    expect(bgError).toContain("5MB");
    expect(bgError).toContain(String(fiveMb));
  });

  it("returns 503 (not a crash) when the R2 binding is missing", async () => {
    const noR2 = makeEnv();
    await runMigrations(noR2);
    const noR2App = makeApp();
    const noR2Cookie = await signIn(noR2App, noR2);

    const res = await upload(
      noR2App,
      noR2,
      noR2Cookie,
      PNG_BYTES,
      "image/png",
      { purpose: "background" },
    );
    expect(res.status).toBe(503);
    expect((await readJson(res)).error).toContain("R2 binding");
  });
});

describe("GET /assets/*", () => {
  let env: Env;
  let r2: MemoryR2;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    r2 = new MemoryR2();
    env = makeEnv({ R2: r2 as unknown as R2Bucket });
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("serves an uploaded PNG with immutable caching and nosniff", async () => {
    const { path } = await readJson(
      await upload(app, env, cookie, PNG_BYTES, "image/png", {
        purpose: "background",
      }),
    );

    const res = await app.request(path, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("serves SVG as image/svg+xml with nosniff (never HTML)", async () => {
    const { path } = await readJson(
      await upload(app, env, cookie, SVG_BYTES, "image/svg+xml", {
        purpose: "logo",
      }),
    );
    const res = await app.request(path, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain("<svg");
  });

  it("404s for an object that does not exist", async () => {
    const res = await app.request(
      "/assets/assets/background/00000000-0000-0000-0000-000000000000.png",
      {},
      env,
    );
    expect(res.status).toBe(404);
  });

  it("404s (no 500) when the R2 binding is missing", async () => {
    const noR2 = makeEnv();
    const res = await makeApp().request("/assets/assets/logo/x.svg", {}, noR2);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/assets", () => {
  let env: Env;
  let r2: MemoryR2;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    r2 = new MemoryR2();
    env = makeEnv({ R2: r2 as unknown as R2Bucket });
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("deletes the object by key", async () => {
    const { path } = await readJson(
      await upload(app, env, cookie, PNG_BYTES, "image/png", {
        purpose: "logo",
      }),
    );
    const key = objectKeyFromPath(path);
    expect(r2.objects.has(key)).toBe(true);

    const res = await app.request(
      "/api/admin/assets",
      {
        method: "DELETE",
        body: JSON.stringify({ key }),
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ success: true });
    expect(r2.objects.has(key)).toBe(false);

    const read = await app.request(path, {}, env);
    expect(read.status).toBe(404);
  });

  it("rejects a missing key", async () => {
    const res = await app.request(
      "/api/admin/assets",
      {
        method: "DELETE",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toContain("key is required");
  });

  it("returns 503 when the R2 binding is missing", async () => {
    const noR2 = makeEnv();
    await runMigrations(noR2);
    const noR2App = makeApp();
    const noR2Cookie = await signIn(noR2App, noR2);
    const res = await noR2App.request(
      "/api/admin/assets",
      {
        method: "DELETE",
        body: JSON.stringify({ key: "assets/logo/x.png" }),
        headers: { "content-type": "application/json", cookie: noR2Cookie },
      },
      noR2,
    );
    expect(res.status).toBe(503);
  });
});

describe("settings.logoUrl + replaced-upload cleanup", () => {
  let env: Env;
  let r2: MemoryR2;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    r2 = new MemoryR2();
    env = makeEnv({ R2: r2 as unknown as R2Bucket });
    app = makeApp();
    await runMigrations(env);
    cookie = await signIn(app, env);
  });

  it("exposes logoUrl in the settings DTO (default empty string)", async () => {
    const res = await app.request(
      "/api/admin/settings",
      { headers: { cookie } },
      env,
    );
    const body = await readJson(res);
    expect(body.logoUrl).toBe("");
    expect(
      (
        await readJson(
          await app.request(
            "/api/admin/settings/keys",
            { headers: { cookie } },
            env,
          ),
        )
      ).keys,
    ).toContain("logo_url");
  });

  it("stores logoUrl through PUT /api/admin/settings", async () => {
    const res = await putSettings(app, env, cookie, {
      logoUrl: "/assets/assets/logo/abc.svg",
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).logoUrl).toBe("/assets/assets/logo/abc.svg");

    const again = await readJson(
      await app.request("/api/admin/settings", { headers: { cookie } }, env),
    );
    expect(again.logoUrl).toBe("/assets/assets/logo/abc.svg");
  });

  it("deletes the old R2 object when a local background is replaced by an URL", async () => {
    const { path } = await readJson(
      await upload(app, env, cookie, PNG_BYTES, "image/png", {
        purpose: "background",
      }),
    );
    const key = objectKeyFromPath(path);

    await putSettings(app, env, cookie, { backgroundUrl: path });
    expect(r2.deleted).toEqual([]);

    await putSettings(app, env, cookie, {
      backgroundUrl: "https://cdn.example.com/bg.jpg",
    });
    expect(r2.deleted).toEqual([key]);
    expect(r2.objects.has(key)).toBe(false);
  });

  it("deletes the old logo when it is replaced by a new upload path", async () => {
    const first = await readJson(
      await upload(app, env, cookie, SVG_BYTES, "image/svg+xml", {
        purpose: "logo",
      }),
    );
    const second = await readJson(
      await upload(app, env, cookie, SVG_BYTES, "image/svg+xml", {
        purpose: "logo",
      }),
    );
    const oldKey = objectKeyFromPath(first.path);
    const newKey = objectKeyFromPath(second.path);

    await putSettings(app, env, cookie, { logoUrl: first.path });
    await putSettings(app, env, cookie, { logoUrl: second.path });

    expect(r2.deleted).toEqual([oldKey]);
    expect(r2.objects.has(oldKey)).toBe(false);
    expect(r2.objects.has(newKey)).toBe(true);
  });

  it("never deletes external URLs and keeps unchanged values", async () => {
    await putSettings(app, env, cookie, {
      backgroundUrl: "https://cdn.example.com/bg.jpg",
      logoUrl: "https://cdn.example.com/logo.svg",
    });
    await putSettings(app, env, cookie, {
      backgroundUrl: "https://cdn.example.com/other.jpg",
    });
    // Same value written again is not a replacement.
    await putSettings(app, env, cookie, {
      backgroundUrl: "https://cdn.example.com/other.jpg",
    });
    expect(r2.deleted).toEqual([]);
  });

  it("keeps the settings write working when the R2 binding is missing", async () => {
    const noR2 = makeEnv();
    await runMigrations(noR2);
    const noR2App = makeApp();
    const noR2Cookie = await signIn(noR2App, noR2);

    const res = await putSettings(noR2App, noR2, noR2Cookie, {
      backgroundUrl: "https://cdn.example.com/bg.jpg",
      logoUrl: "https://cdn.example.com/logo.svg",
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).backgroundUrl).toBe(
      "https://cdn.example.com/bg.jpg",
    );
  });
});
