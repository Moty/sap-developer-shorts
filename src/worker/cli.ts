import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { detectCapabilities, modelBusy } from "./capabilities.js";
import { WorkerClient } from "./client.js";
import { type DeviceConfig, loadDevice, removeDevice, saveDevice } from "./credentials.js";
import { runMacWorker } from "./runner.js";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "register") {
    if (process.platform !== "darwin" || process.arch !== "arm64")
      throw new Error("Register an Apple Silicon Mac for this worker adapter.");
    const origin = args[0],
      name = args[1] ?? hostname();
    if (!origin)
      throw new Error('Usage: npm run worker:register -- https://your-studio.example "Mac mini"');
    new WorkerClient(origin, "");
    const response = await fetch(`${origin}/v1/worker-pairings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
      redirect: "error",
    });
    const pairing = await response.json();
    if (!response.ok) throw new Error(pairing.error ?? "Pairing failed.");
    console.log(
      `Open ${origin}/#pair=${pairing.pairingId} on your signed-in studio.\nConfirm device: ${name}\nPairing code: ${pairing.code}\nWaiting for workspace owner approval (10 minutes)…`,
    );
    while (Date.now() < pairing.expiresAt) {
      await delay(3000);
      const result = await fetch(`${origin}/v1/worker-pairings/${pairing.pairingId}/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pollingSecret: pairing.pollingSecret }),
        redirect: "error",
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error ?? "Pairing failed.");
      if (data.pending) continue;
      const config: DeviceConfig = {
        origin,
        workerId: data.workerId,
        tenantId: data.tenantId,
        expiresAt: data.expiresAt,
      };
      await saveDevice(config, data.credential);
      console.log(
        "Device registered. Credential saved in macOS Keychain. Start it with npm run worker:start.",
      );
      process.exit(0);
    }
    throw new Error("Pairing expired. Start registration again.");
  } else if (command === "capabilities")
    console.log(
      JSON.stringify(
        { capabilities: await detectCapabilities(), busy: await modelBusy() },
        null,
        2,
      ),
    );
  else {
    const { config, credential } = await loadDevice();
    const client = new WorkerClient(config.origin, credential);
    if (command === "start") {
      if (config.expiresAt < Date.now() + 7 * 86400_000) {
        const rotated = await client.request("/v1/worker/rotate", {});
        await saveDevice(
          { ...config, expiresAt: Number(rotated.expiresAt) },
          String(rotated.credential),
        );
        console.log("Device credential rotated. Restarting uses the renewed credential.");
        await runMacWorker(new WorkerClient(config.origin, String(rotated.credential)), shutdown());
      } else await runMacWorker(client, shutdown());
    } else if (command === "status")
      console.log(
        JSON.stringify(
          {
            ...config,
            server: await client.request("/v1/worker/status"),
            capabilities: await detectCapabilities(),
            busy: await modelBusy(),
          },
          null,
          2,
        ),
      );
    else if (command === "unregister") {
      await client.request("/v1/worker/unregister", {});
      await removeDevice();
      console.log("Device revoked and its local Keychain credential removed.");
    } else throw new Error("Choose register, start, status, capabilities, or unregister.");
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
function shutdown() {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  return controller.signal;
}
