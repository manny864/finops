// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(), fetch: vi.fn(), destroy: vi.fn(),
  agents: [] as Array<{ connect: { lookup: (...args: any[]) => void; timeout: number } }>,
}));
vi.mock("dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({
  fetch: mocks.fetch,
  Agent: class {
    constructor(options: any) { mocks.agents.push(options); }
    destroy = mocks.destroy;
  },
}));
import { safeExternalFetch, safeWebhookFetch } from "@/lib/safeExternalFetch";
import { isPublicAddress } from "@/lib/webhookSecurity";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agents.length = 0;
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.fetch.mockResolvedValue(new Response("ok"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pinned outbound transport", () => {
  it("a changed second DNS answer is never used by the socket, preserving Host/SNI", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await safeWebhookFetch("https://hooks.slack.com/services/test", { method: "POST", redirect: "follow" });
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url.hostname).toBe("hooks.slack.com");
    expect(options.redirect).toBe("error");
    const callback = vi.fn();
    mocks.agents[0].connect.lookup("hooks.slack.com", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.agents[0].connect).not.toHaveProperty("rejectUnauthorized");
  });
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.100.100.200",
    "0.0.0.0", "224.0.0.1", "::1", "::ffff:7f00:1", "fd00::1", "fe90::1", "2001:db8::1"])(
    "rejects candidate %s even with another public address", async (address) => {
      mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address, family: address.includes(":") ? 6 : 4 }]);
      await expect(safeExternalFetch("https://customer.example.test")).rejects.toThrow(/private IP/);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it("accepts global IPv6 and pins that address", async () => {
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    mocks.lookup.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }]);
    await safeExternalFetch("https://customer.example.test");
    const callback = vi.fn();
    mocks.agents[0].connect.lookup("customer.example.test", { family: 6 }, callback);
    expect(callback).toHaveBeenCalledWith(null, "2606:4700:4700::1111", 6);
  });
  it("rejects redirects without dispatching a second request", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254" } }));
    await expect(safeExternalFetch("https://customer.example.test")).rejects.toThrow(/redirect/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("bounds response size and closes the dispatcher on failure", async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array(1024 * 1024 + 1)));
    await expect(safeExternalFetch("https://customer.example.test")).rejects.toThrow(/size limit/);
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("rejects empty DNS answers, credentials, literals and disallowed webhook hosts", async () => {
    mocks.lookup.mockResolvedValue([]);
    await expect(safeExternalFetch("https://customer.example.test")).rejects.toThrow(/no addresses/);
    await expect(safeExternalFetch("https://user:pass@customer.example.test")).rejects.toThrow(/credentials/);
    await expect(safeExternalFetch("https://[::ffff:127.0.0.1]")).rejects.toThrow(/literal/);
    await expect(safeWebhookFetch("https://unlisted.example.test")).rejects.toThrow(/allow-list/);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("cancels before network access on an already aborted request", async () => {
    await expect(safeExternalFetch("https://customer.example.test", { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("bounds DNS resolution time before dispatch", async () => {
    vi.useFakeTimers();
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = safeExternalFetch("https://customer.example.test", { signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow();
    controller.abort();
    await assertion;
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
