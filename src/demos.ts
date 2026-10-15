export const demos = {
  "cap-inventory": {
    directory: "demos/cap/inventory",
    runner: "demos/cap/inventory/verify.cjs",
    files: [
      "package.json",
      "package-lock.json",
      "demos/cap/inventory/package.json",
      "demos/cap/inventory/README.md",
      "demos/cap/inventory/verify.cjs",
      "demos/cap/inventory/db/schema.cds",
      "demos/cap/inventory/srv/inventory-service.cds",
      "demos/cap/inventory/db/data/demo-Products.csv",
    ],
    checks: [
      "odata-metadata",
      "seed-products",
      "filter-in-stock",
      "missing-product",
      "readonly-service",
    ],
  },
} as const;
