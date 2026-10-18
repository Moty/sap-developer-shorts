import { fail, type RecordData } from "../cloud/contracts.js";
export class WorkerClient {
  constructor(
    readonly origin: string,
    readonly credential: string,
  ) {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
    )
      throw new Error("Rendering workers require HTTPS or loopback.");
    if (url.origin !== origin || url.username || url.password)
      throw new Error("Use an exact studio origin.");
  }
  async request(path: string, input?: unknown, lease?: string) {
    const headers: Record<string, string> = { authorization: `Device ${this.credential}` };
    if (lease) headers["x-attempt-lease"] = lease;
    const options: RequestInit = {
      method: input === undefined ? "GET" : "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    };
    if (input !== undefined) {
      headers["content-type"] = "application/json";
      options.body = JSON.stringify(input);
    }
    const response = await fetch(`${this.origin}${path}`, options);
    const data = (await response.json()) as RecordData;
    if (!response.ok)
      fail(
        response.status,
        String(data.code ?? "WORKER_REQUEST_FAILED"),
        String(data.error ?? "Rendering service unavailable."),
      );
    return data;
  }
  async download(jobId: string, assetId: string, lease: string) {
    const response = await fetch(`${this.origin}/v1/worker/jobs/${jobId}/assets/${assetId}`, {
      headers: { authorization: `Device ${this.credential}`, "x-attempt-lease": lease },
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error("The job input is unavailable or its lease expired.");
    return Buffer.from(await response.arrayBuffer());
  }
  async upload(jobId: string, lease: string, kind: string, bytes: Buffer) {
    if (bytes.length > 30 * 1024 * 1024)
      throw new Error("The output exceeds the current 30 MiB transfer limit.");
    const response = await fetch(`${this.origin}/v1/worker/jobs/${jobId}/outputs`, {
      method: "POST",
      body: new Uint8Array(bytes),
      headers: {
        authorization: `Device ${this.credential}`,
        "x-attempt-lease": lease,
        "x-output-kind": kind,
        "content-type": "application/octet-stream",
      },
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await response.json()) as RecordData;
    if (!response.ok) throw new Error(String(data.error ?? "Output upload failed."));
    return data;
  }
}
