import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { runMigrations } from "../../db/migrate.ts";
import { createServer } from "../../index.ts";

let server: ReturnType<typeof createServer>;
let baseUrl = "";

beforeAll(async () => {
  await runMigrations();
  server = createServer({ port: 0 });
  baseUrl = `http://${server.hostname}:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("frontend static shell", () => {
  it("serves modular index shell", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html.includes('/js/main.js')).toBe(true);
    expect(html.includes('/styles/tokens.css')).toBe(true);
    expect(html.includes('id="membersList"')).toBe(true);
    expect(html.includes('id="auditList"')).toBe(true);
    expect(html.includes('id="createGroupBtn"')).toBe(true);
    expect(html.includes('id="createDmBtn"')).toBe(true);
  });

  it("serves modular JS and CSS assets", async () => {
    const assets = [
      "/styles/tokens.css",
      "/styles/base.css",
      "/styles/layout.css",
      "/styles/components.css",
      "/styles/responsive.css",
      "/js/main.js",
      "/js/api/rest.js",
      "/js/ws/client.js",
      "/js/ui/drawer.js"
    ];

    for (const asset of assets) {
      const response = await fetch(`${baseUrl}${asset}`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body.length > 0).toBe(true);
    }
  });
});
