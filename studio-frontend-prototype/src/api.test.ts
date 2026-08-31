import { afterEach, describe, expect, it } from "vitest";
import {
  ApiError,
  alignSessionHost,
  apiUrl,
  sessionOrigin,
  type StudioSession,
  waitForStudioSessionReady,
} from "./api";

describe("apiUrl", () => {
  it("prefixes paths with /cf", () => {
    expect(apiUrl("/account-management/v1/me")).toBe("/cf/account-management/v1/me");
  });
  it("normalizes a missing leading slash", () => {
    expect(apiUrl("account-management/v1/me")).toBe("/cf/account-management/v1/me");
  });
});

describe("ApiError", () => {
  it("carries status and body", () => {
    const e = new ApiError(400, { title: "Failed Precondition" });
    expect(e.status).toBe(400);
    expect(e.message).toContain("400");
  });
});

describe("alignSessionHost", () => {
  // The tests run in vitest's default node environment, so `window` has to be
  // faked. Only `location.hostname` is read.
  const at = (hostname: string) => {
    (globalThis as { window?: unknown }).window = { location: { hostname } };
  };
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("moves a localhost session onto the host the portal is served from", () => {
    at("127.0.0.1");
    // Why this matters: the IDE's gate cookie is SameSite=Lax, and
    // 127.0.0.1 vs localhost are different sites — the cookie would be
    // dropped inside the iframe and the IDE would answer 403.
    expect(alignSessionHost("http://localhost:41000/")).toBe("http://127.0.0.1:41000/");
  });

  it("keeps the port and the token query intact", () => {
    at("127.0.0.1");
    expect(alignSessionHost("http://localhost:41007/?token=abc")).toBe(
      "http://127.0.0.1:41007/?token=abc",
    );
  });

  it("leaves a session already on the portal's host alone", () => {
    at("localhost");
    expect(alignSessionHost("http://localhost:41000/")).toBe("http://localhost:41000/");
  });

  it("never rewrites a real hostname — that is deliberate configuration", () => {
    at("127.0.0.1");
    expect(alignSessionHost("http://studio.example.com:41000/")).toBe(
      "http://studio.example.com:41000/",
    );
  });

  it("does not drag a remotely-served portal onto loopback", () => {
    at("studio.example.com");
    expect(alignSessionHost("http://localhost:41000/")).toBe("http://localhost:41000/");
  });

  it("hands back anything that is not a URL", () => {
    at("127.0.0.1");
    expect(alignSessionHost("")).toBe("");
  });
});

describe("sessionOrigin", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("resolves a relative Kubernetes session URL against the portal", () => {
    (globalThis as { window?: unknown }).window = {
      location: { href: "https://studio-dev-poc.cfabric.org/space/workspace-1" },
    };
    expect(sessionOrigin("/studio/session-1/?token=secret")).toBe(
      "https://studio-dev-poc.cfabric.org",
    );
  });

  it("keeps the origin of an absolute session URL", () => {
    (globalThis as { window?: unknown }).window = {
      location: { href: "https://studio-dev-poc.cfabric.org/" },
    };
    expect(sessionOrigin("http://127.0.0.1:41000/?token=secret")).toBe(
      "http://127.0.0.1:41000",
    );
  });
});

describe("waitForStudioSessionReady", () => {
  const session = (state: StudioSession["state"]): StudioSession => ({
    id: "session-1",
    workspace_id: "workspace-1",
    state,
    url: "/cf/studio-session/v1/ide/session-1/",
    created_at_epoch_secs: 1,
    sources: [],
  });

  it("does not refresh an already-running session", async () => {
    let refreshes = 0;
    const ready = await waitForStudioSessionReady(session("running"), async () => {
      refreshes += 1;
      return session("running");
    });
    expect(ready.state).toBe("running");
    expect(refreshes).toBe(0);
  });

  it("polls a starting Kubernetes session before returning its URL", async () => {
    const states: StudioSession["state"][] = ["starting", "running"];
    const ready = await waitForStudioSessionReady(
      session("starting"),
      async () => session(states.shift() ?? "running"),
      { sleep: async () => undefined },
    );
    expect(ready.state).toBe("running");
    expect(states).toHaveLength(0);
  });

  it("fails clearly when the runtime stops during startup", async () => {
    await expect(
      waitForStudioSessionReady(session("starting"), async () => session("stopped"), {
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("stopped before it became ready");
  });

  it("times out instead of polling forever", async () => {
    let clock = 0;
    await expect(
      waitForStudioSessionReady(session("starting"), async () => session("starting"), {
        timeoutMs: 10,
        pollIntervalMs: 10,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
      }),
    ).rejects.toThrow("did not become ready");
  });
});
