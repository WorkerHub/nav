import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupPage } from "@/components/setup/setup-page";
import { getSetupState } from "@/lib/api";
import { useNavStore, type AuthStatus } from "@/lib/nav-store";
import type { SetupState } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSetupState: vi.fn(),
  };
});

const getSetupStateMock = vi.mocked(getSetupState);

/** setup 页面已在管理面被关闭（本单的复现场景）。 */
const disabledState: SetupState = {
  enabled: false,
  ownerExists: true,
  tablePrefix: "nav_",
};

function seedAuth(authStatus: AuthStatus) {
  useNavStore.setState({ authStatus, loginPromptOpen: false });
}

const noop = () => {};

function renderSetupPage() {
  return render(<SetupPage onGoHome={noop} onGoAdmin={noop} />);
}

/**
 * 让事件循环空转一会儿：给「不该发生的重复请求」留出真的发生的时间。
 * 死循环 bug 每轮都要过 await（一次 GET），几十毫秒足够积累出多次调用。
 */
async function settle(ms = 60) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("SetupPage：setup 页面关闭后的形态与状态请求次数", () => {
  beforeEach(() => {
    getSetupStateMock.mockReset();
    getSetupStateMock.mockResolvedValue({ ...disabledState });
    seedAuth("anonymous");
  });

  it("已登录 + 关闭：只取一次状态，停在「已关闭」提示，不再无限转圈", async () => {
    seedAuth("authenticated");
    renderSetupPage();

    await screen.findByText(/setup 页面已关闭/);
    await settle();

    // 回归点：旧实现的 effect 依赖 phase.kind，disabled→loading→disabled 无限重触发
    expect(getSetupStateMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/setup 页面已关闭/)).toBeInTheDocument();
    expect(screen.queryByText(/正在检查数据库状态/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /进入管理面/ }),
    ).toBeInTheDocument();
  });

  it("未登录 + 关闭：同样只取一次，给「去登录」入口、不给管理面入口", async () => {
    renderSetupPage();

    await screen.findByText(/setup 页面已关闭/);
    await settle();

    expect(getSetupStateMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /去登录/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /进入管理面/ })).toBeNull();
  });

  it("在关闭页面上登录：补取一次状态，翻到已初始化形态", async () => {
    renderSetupPage();

    await screen.findByText(/setup 页面已关闭/);
    expect(getSetupStateMock).toHaveBeenCalledTimes(1);

    // 所有者在管理面开启页面后再登录：补取的那一次应拿到开启后的状态
    getSetupStateMock.mockResolvedValue({
      enabled: true,
      ownerExists: true,
      tablePrefix: "nav_",
    });
    act(() => {
      seedAuth("authenticated");
    });

    await screen.findByText(/数据库已初始化/);
    await settle();

    expect(getSetupStateMock).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: /检查并升级数据库/ }),
    ).toBeInTheDocument();
  });

  it("刷新恢复会话（pending → authenticated）不触发补取", async () => {
    seedAuth("pending");
    renderSetupPage();

    await screen.findByText(/setup 页面已关闭/);
    act(() => {
      seedAuth("authenticated");
    });
    await settle();

    // 首次取状态已发生在探活之前/期间，setup 状态与登录态无关，不必再取
    expect(getSetupStateMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/setup 页面已关闭/)).toBeInTheDocument();
  });

  it("未初始化形态：登录态变化不覆盖当前形态（建号结果不被刷掉）", async () => {
    getSetupStateMock.mockResolvedValue({
      enabled: true,
      ownerExists: false,
      tablePrefix: "nav_",
    });
    renderSetupPage();

    await screen.findByText(/数据库尚未初始化/);
    act(() => {
      seedAuth("authenticated");
    });
    await settle();

    expect(getSetupStateMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/数据库尚未初始化/)).toBeInTheDocument();
  });
});
