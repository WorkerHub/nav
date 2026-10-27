import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryPanel, LinkPanel } from "@/components/admin/crud-panels";
import { SearchEnginePanel } from "@/components/admin/settings-panels";
import {
  adminCreateCategory,
  adminDeleteAsset,
  adminUpdateCategory,
  adminUpdateEngine,
  adminUpdateLink,
  adminUploadAsset,
} from "@/lib/api";
import type { AdminCategory, AdminLink, SearchEngine } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    adminUploadAsset: vi.fn(),
    adminDeleteAsset: vi.fn(),
    adminCreateCategory: vi.fn(),
    adminUpdateCategory: vi.fn(),
    adminUpdateLink: vi.fn(),
    adminUpdateEngine: vi.fn(),
  };
});

const uploadMock = vi.mocked(adminUploadAsset);
const deleteMock = vi.mocked(adminDeleteAsset);
const createCategoryMock = vi.mocked(adminCreateCategory);
const updateCategoryMock = vi.mocked(adminUpdateCategory);
const updateLinkMock = vi.mocked(adminUpdateLink);
const updateEngineMock = vi.mocked(adminUpdateEngine);

const file = new File([new Uint8Array([1, 2, 3])], "icon.png", {
  type: "image/png",
});

const stamp = "2026-10-26T00:00:00.000Z";

const category: AdminCategory = {
  id: "c1",
  name: "开发",
  icon: null,
  sortOrder: 0,
  visibility: "public",
  createdAt: stamp,
  updatedAt: stamp,
};

const link: AdminLink = {
  id: "l1",
  categoryId: "c1",
  title: "GitHub",
  url: "https://github.com",
  iconUrl: null,
  description: null,
  sortOrder: 0,
  visibility: "public",
  createdAt: stamp,
  updatedAt: stamp,
};

const engine: SearchEngine = {
  id: "e1",
  name: "Google",
  urlTemplate: "https://www.google.com/search?q={q}",
  icon: null,
  sortOrder: 0,
  isDefault: true,
};

function pickFile(input: HTMLElement) {
  fireEvent.change(input, { target: { files: [file] } });
}

/** 点列表行进入编辑：直接点行内的名称文本（拖拽把手也叫「拖拽排序：<名称>」，不能用 name 正则）。 */
async function openRow(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(screen.getByText(label));
}

beforeEach(() => {
  uploadMock.mockReset();
  deleteMock.mockReset();
  createCategoryMock.mockReset();
  updateCategoryMock.mockReset();
  updateLinkMock.mockReset();
  updateEngineMock.mockReset();
  createCategoryMock.mockImplementation(async (input) => ({
    ...category,
    id: "c2",
    name: input.name,
    icon: input.icon ?? null,
  }));
  updateCategoryMock.mockImplementation(async (id, input) => ({
    ...category,
    id,
    ...input,
  }));
  updateLinkMock.mockImplementation(async (id, input) => ({
    ...link,
    id,
    ...input,
  }));
  updateEngineMock.mockImplementation(async (id, input) => ({
    ...engine,
    id,
    ...input,
  }));
});

describe("CategoryPanel：分类图标上传 / 回填 / 清旧 / 列表预览", () => {
  it("新建分类：上传图标后回填并随创建提交", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/cat-1.png" });

    render(<CategoryPanel categories={[category]} onChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "新建分类" }));
    await user.type(screen.getByLabelText("名称"), "阅读");
    pickFile(screen.getByLabelText("上传分类图标"));

    await waitFor(() =>
      expect(screen.getByLabelText("分类图标")).toHaveValue(
        "/assets/assets/icon/cat-1.png",
      ),
    );
    expect(screen.getByAltText("分类图标预览")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(createCategoryMock).toHaveBeenCalledTimes(1));
    expect(createCategoryMock.mock.calls[0][0]).toEqual({
      name: "阅读",
      icon: "/assets/assets/icon/cat-1.png",
      visibility: "public",
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("替换已有图标：保存后删掉旧 R2 对象", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/cat-new.png" });

    render(
      <CategoryPanel
        categories={[{ ...category, icon: "/assets/assets/icon/cat-old.png" }]}
        onChanged={vi.fn()}
      />,
    );

    // 列表预览已有图标
    expect(
      document.querySelector('img[src="/assets/assets/icon/cat-old.png"]'),
    ).not.toBeNull();

    await openRow(user, "开发");
    pickFile(screen.getByLabelText("上传分类图标"));
    await waitFor(() =>
      expect(screen.getByLabelText("分类图标")).toHaveValue(
        "/assets/assets/icon/cat-new.png",
      ),
    );

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateCategoryMock).toHaveBeenCalledWith("c1", {
        name: "开发",
        icon: "/assets/assets/icon/cat-new.png",
        visibility: "public",
      }),
    );
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        "/assets/assets/icon/cat-old.png",
      ),
    );
  });
});

describe("LinkPanel：链接图标上传 / 回填 / 清旧", () => {
  it("上传图标后回填 iconUrl 并随更新提交，同时清掉旧图标", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/link-new.png" });

    render(
      <LinkPanel
        categories={[category]}
        links={[{ ...link, iconUrl: "/assets/assets/icon/link-old.png" }]}
        onChanged={vi.fn()}
      />,
    );

    await openRow(user, "GitHub");
    pickFile(screen.getByLabelText("上传链接图标"));
    await waitFor(() =>
      expect(screen.getByLabelText("链接图标")).toHaveValue(
        "/assets/assets/icon/link-new.png",
      ),
    );

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateLinkMock).toHaveBeenCalledWith("l1", {
        title: "GitHub",
        url: "https://github.com",
        iconUrl: "/assets/assets/icon/link-new.png",
        description: null,
        visibility: "public",
      }),
    );
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        "/assets/assets/icon/link-old.png",
      ),
    );
  });

  it("移除图标：保存后 iconUrl 为 null，旧图标被删", async () => {
    const user = userEvent.setup();

    render(
      <LinkPanel
        categories={[category]}
        links={[{ ...link, iconUrl: "/assets/assets/icon/link-old.png" }]}
        onChanged={vi.fn()}
      />,
    );

    await openRow(user, "GitHub");
    await user.click(screen.getByRole("button", { name: /移除/ }));
    expect(screen.getByLabelText("链接图标")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateLinkMock).toHaveBeenCalledWith(
        "l1",
        expect.objectContaining({ iconUrl: null }),
      ),
    );
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        "/assets/assets/icon/link-old.png",
      ),
    );
  });
});

describe("SearchEnginePanel：搜索引擎图标上传 / 回填 / 列表预览", () => {
  it("上传图标后回填并随更新提交", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ path: "/assets/assets/icon/eng-1.svg" });

    render(<SearchEnginePanel engines={[engine]} onChanged={vi.fn()} />);

    await openRow(user, "Google");
    pickFile(screen.getByLabelText("上传图标"));
    await waitFor(() =>
      expect(screen.getByLabelText("图标")).toHaveValue(
        "/assets/assets/icon/eng-1.svg",
      ),
    );
    expect(screen.getByAltText("图标预览")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateEngineMock).toHaveBeenCalledWith("e1", {
        name: "Google",
        urlTemplate: "https://www.google.com/search?q={q}",
        icon: "/assets/assets/icon/eng-1.svg",
        isDefault: true,
      }),
    );
  });

  it("列表里渲染已存图标（后台预览）", () => {
    render(
      <SearchEnginePanel
        engines={[{ ...engine, icon: "/assets/assets/icon/eng-stored.png" }]}
        onChanged={vi.fn()}
      />,
    );

    expect(
      document.querySelector('img[src="/assets/assets/icon/eng-stored.png"]'),
    ).not.toBeNull();
  });
});
