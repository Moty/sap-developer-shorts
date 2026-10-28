// Extra live evidence for the held-out writing briefs; no existing artifacts are replaced.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const cds = require("@sap/cds");

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error("Pass a new evidence output file");
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
    const base = "/odata/v4/inventory/Products";
    const get = async (suffix) => {
      const response = await fetch(origin + base + suffix, {
        signal: AbortSignal.timeout(10000),
      });
      return { status: response.status, body: await response.json() };
    };
    captures.selected = await get("?$select=title&$orderby=title");
    assert.equal(captures.selected.status, 200);
    assert.deepEqual(captures.selected.body.value, [
      { ID: "11111111-1111-4111-8111-111111111111", title: "Mechanical Keyboard" },
      { ID: "33333333-3333-4333-8333-333333333333", title: "Monitor Arm" },
      { ID: "22222222-2222-4222-8222-222222222222", title: "USB-C Dock" },
    ]);
    checks.push("select-title-retains-id");
    captures.knownKey = await get("(11111111-1111-4111-8111-111111111111)");
    assert.equal(captures.knownKey.status, 200);
    assert.equal(captures.knownKey.body.title, "Mechanical Keyboard");
    assert.equal(captures.knownKey.body.stock, 12);
    checks.push("known-key-is-200");
    const countResponse = await fetch(`${origin}${base}/$count`, {
      signal: AbortSignal.timeout(10000),
    });
    captures.count = { status: countResponse.status, text: await countResponse.text() };
    assert.equal(captures.count.status, 200);
    assert.equal(captures.count.text.trim(), "3");
    checks.push("count-is-three-rows");
    const filteredCountResponse = await fetch(`${origin}${base}/$count?$filter=stock%20gt%200`, {
      signal: AbortSignal.timeout(10000),
    });
    captures.filteredCount = {
      status: filteredCountResponse.status,
      text: await filteredCountResponse.text(),
    };
    assert.equal(captures.filteredCount.status, 200);
    assert.equal(captures.filteredCount.text.trim(), "2");
    checks.push("filtered-count-is-two-rows");
    captures.stockOrder = await get("?$orderby=stock%20desc");
    assert.equal(captures.stockOrder.status, 200);
    assert.deepEqual(
      captures.stockOrder.body.value.map((p) => [p.title, p.stock]),
      [
        ["Mechanical Keyboard", 12],
        ["USB-C Dock", 7],
        ["Monitor Arm", 0],
      ],
    );
    checks.push("stock-order-desc");
    captures.empty = await get("?$filter=stock%20gt%201000");
    assert.equal(captures.empty.status, 200);
    assert.deepEqual(captures.empty.body.value, []);
    checks.push("empty-filter-is-200");
    captures.missing = await get("(aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)");
    assert.equal(captures.missing.status, 404);
    checks.push("missing-key-is-404");
    captures.afterQueries = await get("?$orderby=title");
    assert.equal(captures.afterQueries.status, 200);
    assert.deepEqual(
      captures.afterQueries.body.value.map((p) => [p.title, p.stock]),
      [
        ["Mechanical Keyboard", 12],
        ["Monitor Arm", 0],
        ["USB-C Dock", 7],
      ],
    );
    checks.push("queries-leave-seed-rows-intact");
    const root = path.resolve(__dirname, "../..");
    const sourceFileSha256 = {};
    for (const file of [
      "demos/cap/inventory/db/schema.cds",
      "demos/cap/inventory/db/data/demo-Products.csv",
      "demos/cap/inventory/srv/inventory-service.cds",
      "scripts/editorial/cap-evidence.cjs",
    ]) {
      sourceFileSha256[file] = createHash("sha256")
        .update(await readFile(path.join(root, file)))
        .digest("hex");
    }
    await writeFile(
      output,
      `${JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          node: process.version,
          cds: cds.version,
          database: "isolated-sqlite-memory",
          sourceFileSha256,
          checks,
          captures,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
    console.log(`PASS: ${checks.length} extra live CAP writing-evidence checks.`);
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

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
