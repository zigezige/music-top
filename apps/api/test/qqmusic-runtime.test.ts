import { describe, expect, it } from "vitest";

const runtimeModule = await import("../src/catalog/qqmusic-runtime.js").catch(() => null);

describe("embedded QQ Music API runtime", () => {
  it("starts the compatible API on loopback and closes it cleanly", async () => {
    expect(runtimeModule).not.toBeNull();
    if (!runtimeModule) return;

    const service = await runtimeModule.startEmbeddedQqMusicApi(0);
    try {
      const response = await fetch(`${service.baseUrl}/getSmartbox`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ response: null });
    } finally {
      await service.close();
    }
  });
});
