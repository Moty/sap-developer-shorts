import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { loadPrivateConfig } from "../src/cloud/config.js";
import { createPrivateServer } from "../src/cloud/http.js";
import type { WorkspaceService } from "../src/cloud/service.js";

const baseConfig = {
  projectId: "private-project",
  storageBucket: "private-project.appspot.com",
  apiKey: "public-web-key",
  authDomain: "private-project.firebaseapp.com",
  appId: "private-app",
  origin: "http://127.0.0.1:5890",
  port: 5890,
  pilotEmails: [],
  emulator: false,
};

async function configFile(t: TestContext, value: Record<string, unknown>) {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-private-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "config.json");
  await writeFile(path, JSON.stringify(value));
  return path;
}

test("private studio permits plaintext only on loopback and defaults to a loopback listener", async (t) => {
  const local = await loadPrivateConfig(await configFile(t, baseConfig));
  assert.equal(local.origin, "http://127.0.0.1:5890");
  assert.equal(local.listenHost, "127.0.0.1");

  for (const origin of [
    "http://192.168.50.49:5890",
    "http://100.90.80.70:5890",
    "http://studio.example.ts.net:5890",
  ]) {
    await assert.rejects(
      loadPrivateConfig(await configFile(t, { ...baseConfig, origin })),
      /requires HTTPS outside loopback/u,
    );
  }
});

test("private server accepts only its configured host and browser origin", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-private-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = await loadPrivateConfig(
    await configFile(t, {
      ...baseConfig,
      origin: "https://studio.example.test",
      listenHost: "0.0.0.0",
    }),
  );
  const server = createPrivateServer(
    {} as WorkspaceService,
    async () => ({ uid: "unused", email: "unused@example.test", authTime: Date.now() }),
    config,
    directory,
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (path: string, host: string, origin?: string, method = "GET") =>
    new Promise<number>((resolve, reject) => {
      const outbound = request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path,
          method,
          headers: { host, ...(origin ? { origin } : {}) },
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        },
      );
      outbound.once("error", reject);
      outbound.end();
    });

  assert.equal(await call("/v1/config", "192.168.50.49:5890"), 403);
  assert.equal(await call("/v1/config", "studio.example.test"), 200);
  assert.equal(
    await call("/v1/config", "studio.example.test", "http://192.168.50.49:5890", "OPTIONS"),
    403,
  );
  assert.equal(
    await call("/v1/config", "studio.example.test", "https://studio.example.test", "OPTIONS"),
    204,
  );
  assert.equal(await call("/healthz", "unconfigured.internal"), 200);
});

test("private studio exposes an all-interface listener only behind a production HTTPS origin", async (t) => {
  const secure = await loadPrivateConfig(
    await configFile(t, {
      ...baseConfig,
      origin: "https://studio.example.test",
      listenHost: "0.0.0.0",
    }),
  );
  assert.equal(secure.listenHost, "0.0.0.0");

  await assert.rejects(
    loadPrivateConfig(await configFile(t, { ...baseConfig, listenHost: "0.0.0.0" })),
    /all-interface listener requires a production HTTPS origin/u,
  );
  await assert.rejects(
    loadPrivateConfig(
      await configFile(t, {
        ...baseConfig,
        projectId: "demo-private-project",
        emulator: true,
        origin: "https://studio.example.test",
        listenHost: "0.0.0.0",
      }),
    ),
    /all-interface listener requires a production HTTPS origin/u,
  );
  await assert.rejects(
    loadPrivateConfig(
      await configFile(t, {
        ...baseConfig,
        origin: "https://studio.example.test",
        listenHost: "192.168.50.49",
      }),
    ),
    /listener must use loopback or explicit 0\.0\.0\.0/u,
  );
});
