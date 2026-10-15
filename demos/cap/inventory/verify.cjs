const assert = require("node:assert/strict");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const cds = require("@sap/cds");

// This process has its own CAP singleton and an ephemeral in-memory database.
async function verify() {
  cds.env.requires.db = {
    kind: "sqlite",
    impl: "@cap-js/sqlite",
    credentials: { url: ":memory:" },
  };
  cds.env.requires.auth = { kind: "mocked" };
  const checks = [];
  const captures = {};
  let server;
  try {
    server = await cds.server({ port: 0, in_memory: true });
    if (!server.listening) await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const get = (url) => fetch(`${origin}${url}`, { signal: AbortSignal.timeout(10000) });

    const metadata = await get("/odata/v4/inventory/$metadata");
    assert.equal(metadata.status, 200);
    captures.metadata = await metadata.text();
    assert.match(captures.metadata, /EntitySet Name="Products"/);
    assert.match(captures.metadata, /edmx:Edmx[^>]*Version="4.0"/);
    checks.push("odata-metadata");

    const products = await get("/odata/v4/inventory/Products?$orderby=title");
    assert.equal(products.status, 200);
    captures.products = await products.json();
    assert.deepEqual(
      captures.products.value.map(({ title, stock }) => ({ title, stock })),
      [
        { title: "Mechanical Keyboard", stock: 12 },
        { title: "Monitor Arm", stock: 0 },
        { title: "USB-C Dock", stock: 7 },
      ],
    );
    checks.push("seed-products");

    const filtered = await get(
      "/odata/v4/inventory/Products?$filter=stock%20gt%200&$select=title,stock&$orderby=title",
    );
    assert.equal(filtered.status, 200);
    captures.filtered = await filtered.json();
    assert.deepEqual(captures.filtered.value, [
      { ID: "11111111-1111-4111-8111-111111111111", title: "Mechanical Keyboard", stock: 12 },
      { ID: "22222222-2222-4222-8222-222222222222", title: "USB-C Dock", stock: 7 },
    ]);
    checks.push("filter-in-stock");

    const missing = await get("/odata/v4/inventory/Products(aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)");
    assert.equal(missing.status, 404);
    checks.push("missing-product");

    const write = await fetch(`${origin}/odata/v4/inventory/Products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Unexpected write", stock: 1 }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(write.status, 405);
    checks.push("readonly-service");

    return {
      demoId: "cap-inventory",
      verifiedAt: new Date().toISOString(),
      environment: { node: process.version, cds: cds.version, database: "sqlite-memory" },
      checks,
      captures,
    };
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
    if (cds.db) await cds.db.disconnect();
  }
}

verify()
  .then(async (evidence) => {
    const output = process.argv[2];
    if (output) {
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    }
    console.log(`PASS: ${evidence.checks.length} live CAP checks (${evidence.environment.cds}).`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
