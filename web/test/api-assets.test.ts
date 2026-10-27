import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 接口层真实链路（非 dev mock）：上传走 multipart 且不写 Content-Type，
 * 删除走 JSON `{key}`，后端错误原文透出（大小 / 类型超限文案由后端给）。
 *
 * 打包时 `USE_MOCK = import.meta.env.DEV`，这里把 DEV 关掉后动态 import，
 * 让模块求值时走真实 fetch 分支。
 */

async function loadApi() {
  vi.resetModules();
  vi.stubEnv("DEV", false);
  return import("@/lib/api");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("资产接口（真实链路）", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("adminUploadAsset：FormData 带 file + purpose，不设 JSON Content-Type，返回 path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ path: "/assets/assets/logo/abc.png" }, 201),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { adminUploadAsset } = await loadApi();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
      type: "image/png",
    });

    const res = await adminUploadAsset(file, "logo");

    expect(res).toEqual({ path: "/assets/assets/logo/abc.png" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/assets");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    // multipart 必须让浏览器自己带 boundary：不能手写 Content-Type
    expect(new Headers(init.headers).has("content-type")).toBe(false);
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("purpose")).toBe("logo");
    expect(body.get("file")).toBeInstanceOf(File);
    expect((body.get("file") as File).name).toBe("a.png");
  });

  it("adminUploadAsset：失败时抛 ApiError，message 为后端 error 原文、status 原样", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: "background 超过 5MB 上限（当前 6.0MB）" },
            413,
          ),
        ),
    );

    const { adminUploadAsset, ApiError } = await loadApi();
    const file = new File([new Uint8Array([1])], "big.png", {
      type: "image/png",
    });

    const error = await adminUploadAsset(file, "background").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).status).toBe(413);
    expect((error as Error).message).toBe(
      "background 超过 5MB 上限（当前 6.0MB）",
    );
  });

  it("adminDeleteAsset：DELETE /api/admin/assets，body 为 { key }", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { adminDeleteAsset } = await loadApi();
    await adminDeleteAsset("/assets/assets/icon/old.svg");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/assets");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({
      key: "/assets/assets/icon/old.svg",
    });
  });
});
