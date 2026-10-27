import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/admin/settings-panels";
import { adminUpdateSettings, adminUploadAsset } from "@/lib/api";
import type { SiteSettings } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminUploadAsset: vi.fn(),
    adminDeleteAsset: vi.fn(),
    adminUpdateSettings: vi.fn(),
  };
});

const uploadMock = vi.mocked(adminUploadAsset);
const updateSettingsMock = vi.mocked(adminUpdateSettings);

const baseSettings: SiteSettings = {
  siteTitle: "我的导航",
  backgroundUrl: "",
  logoUrl: "",
  theme: "system",
  columns: 6,
};

const file = new File([new Uint8Array([1, 2, 3])], "pic.png", {
  type: "image/png",
});

function pickFile(input: HTMLElement) {
  fireEvent.change(input, { target: { files: [file] } });
}

describe("SettingsPanel：背景图与 Logo 的上传 / 预览 / 移除", () => {
  beforeEach(() => {
    uploadMock.mockReset();
    updateSettingsMock.mockReset();
    updateSettingsMock.mockImplementation(async (input) => ({
      ...baseSettings,
      ...input,
    }));
  });

  it("渲染「背景图」与「站点 Logo」两个字段，并回显已有值", () => {
    render(
      <SettingsPanel
        settings={{
          ...baseSettings,
          backgroundUrl: "/assets/assets/background/bg.png",
          logoUrl: "/assets/assets/logo/logo.png",
        }}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("背景图")).toHaveValue(
      "/assets/assets/background/bg.png",
    );
    expect(screen.getByLabelText("站点 Logo")).toHaveValue(
      "/assets/assets/logo/logo.png",
    );
    expect(screen.getByAltText("背景图预览")).toBeInTheDocument();
    expect(screen.getByAltText("站点 Logo预览")).toBeInTheDocument();
  });

  it("背景上传 → 回填 + 预览；移除 → 清空；保存带上 backgroundUrl / logoUrl", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    uploadMock.mockResolvedValue({
      path: "/assets/assets/background/up-1.png",
    });

    render(<SettingsPanel settings={baseSettings} onChanged={onChanged} />);

    pickFile(screen.getByLabelText("上传背景图"));
    await waitFor(() =>
      expect(screen.getByLabelText("背景图")).toHaveValue(
        "/assets/assets/background/up-1.png",
      ),
    );
    expect(uploadMock).toHaveBeenCalledWith(file, "background");
    expect(screen.getByAltText("背景图预览")).toHaveAttribute(
      "src",
      "/assets/assets/background/up-1.png",
    );

    // 移除：背景图清空（旧 R2 对象由后端在保存时自动清旧）
    await user.click(screen.getAllByRole("button", { name: /移除/ })[0]);
    expect(screen.getByLabelText("背景图")).toHaveValue("");
    expect(screen.queryByAltText("背景图预览")).toBeNull();
    expect(screen.getByLabelText("站点 Logo")).toHaveValue("");

    // 重新上传一次背景，然后保存
    pickFile(screen.getByLabelText("上传背景图"));
    await waitFor(() =>
      expect(screen.getByLabelText("背景图")).toHaveValue(
        "/assets/assets/background/up-1.png",
      ),
    );

    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(updateSettingsMock).toHaveBeenCalledTimes(1));
    expect(updateSettingsMock.mock.calls[0][0]).toMatchObject({
      siteTitle: "我的导航",
      backgroundUrl: "/assets/assets/background/up-1.png",
      logoUrl: "",
      columns: 6,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("Logo 上传 → 回填 logoUrl，保存时随 adminUpdateSettings 提交", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/logo/up-1.svg" });

    render(<SettingsPanel settings={baseSettings} onChanged={vi.fn()} />);

    pickFile(screen.getByLabelText("上传站点 Logo"));
    await waitFor(() =>
      expect(screen.getByLabelText("站点 Logo")).toHaveValue(
        "/assets/assets/logo/up-1.svg",
      ),
    );
    expect(uploadMock).toHaveBeenCalledWith(file, "logo");
    expect(screen.getByAltText("站点 Logo预览")).toHaveAttribute(
      "src",
      "/assets/assets/logo/up-1.svg",
    );

    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(updateSettingsMock).toHaveBeenCalledTimes(1));
    expect(updateSettingsMock.mock.calls[0][0]).toMatchObject({
      logoUrl: "/assets/assets/logo/up-1.svg",
    });
  });
});
