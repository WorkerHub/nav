import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { AssetUploadField } from "@/components/admin/asset-upload";
import { adminUploadAsset } from "@/lib/api";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminUploadAsset: vi.fn(),
    adminDeleteAsset: vi.fn(),
  };
});

const uploadMock = vi.mocked(adminUploadAsset);

function Harness({
  initial = "",
  onUploaded,
  onChange,
}: {
  initial?: string;
  onUploaded?: (path: string) => void;
  onChange?: (next: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <AssetUploadField
      id="bg"
      label="背景图"
      purpose="background"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      onUploaded={onUploaded}
    />
  );
}

function pickFile(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

const imageFile = new File([new Uint8Array([1, 2, 3])], "bg.png", {
  type: "image/png",
});

describe("AssetUploadField", () => {
  beforeEach(() => {
    uploadMock.mockReset();
  });

  it("既有值：输入框回显 + 渲染预览图", () => {
    render(<Harness initial="/assets/assets/background/old.png" />);

    expect(screen.getByLabelText("背景图")).toHaveValue(
      "/assets/assets/background/old.png",
    );
    expect(screen.getByAltText("背景图预览")).toHaveAttribute(
      "src",
      "/assets/assets/background/old.png",
    );
  });

  it("上传成功：回填返回的 /assets 路径 + 预览 + 成功提示", async () => {
    uploadMock.mockResolvedValue({
      path: "/assets/assets/background/new.png",
    });
    const onUploaded = vi.fn();
    render(<Harness onUploaded={onUploaded} />);

    expect(screen.queryByAltText("背景图预览")).toBeNull();
    pickFile(screen.getByLabelText("上传背景图"), imageFile);

    await waitFor(() =>
      expect(screen.getByLabelText("背景图")).toHaveValue(
        "/assets/assets/background/new.png",
      ),
    );
    expect(screen.getByAltText("背景图预览")).toHaveAttribute(
      "src",
      "/assets/assets/background/new.png",
    );
    expect(uploadMock).toHaveBeenCalledWith(imageFile, "background");
    expect(onUploaded).toHaveBeenCalledWith(
      "/assets/assets/background/new.png",
    );
    expect(toast.success).toHaveBeenCalledWith("背景图已上传");
  });

  it("上传失败：透出后端 error 原文，字段保持不变", async () => {
    uploadMock.mockRejectedValue(
      new Error("background 超过 5MB 上限（当前 6.0MB）"),
    );
    render(<Harness initial="/assets/assets/background/keep.png" />);

    pickFile(screen.getByLabelText("上传背景图"), imageFile);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "上传失败：background 超过 5MB 上限（当前 6.0MB）",
      ),
    );
    expect(screen.getByLabelText("背景图")).toHaveValue(
      "/assets/assets/background/keep.png",
    );
  });

  it("点移除：清空字段并撤下预览", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        initial="/assets/assets/background/old.png"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /移除/ }));

    expect(screen.getByLabelText("背景图")).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(screen.queryByAltText("背景图预览")).toBeNull();
  });
});
