# CAP-02: seed and query local CAP data

This lesson starts with the existing read-only inventory service. It shows the
actual registered `db/data/demo-Products.csv`, then the HTTP results captured by
the demo's live verifier. It uses the normal professional Heart narrator and
the shared captions, MP4, companion draft, and review studio workflow.

```sh
npm ci
npm run shorts -- voice-setup
npm run shorts -- produce CAP-02 --serve
```

The current recording is **53.655 seconds**, with a **2.350-second opening** and
eighteen captions. The vertical MP4 is 53.667 seconds at 30 fps; caption boundaries
are model estimates. Production remains local and the companion post is a draft.

## The observed queries

Run `npm run demo` from the repository root. The first displayed URL is:

```text
http://localhost:4004/odata/v4/inventory/Products?$orderby=title
```

Its captured result contains Mechanical Keyboard (12), Monitor Arm (0), and
USB-C Dock (7), in that order. The second displayed URL is the exact combined
query used by the verifier:

```text
http://localhost:4004/odata/v4/inventory/Products?$filter=stock%20gt%200&$select=title,stock&$orderby=title
```

The captured response contains the keyboard and dock with their IDs, titles, and
stock values. The video cards display title and stock. This lesson makes no
claim that `$select` removes ID or reduces this three-field payload. Trying a
different threshold is a viewer exercise, not an additional verified result.

All five existing demo checks remain required: metadata, three seeded products,
the exact stock filter, a missing product, and a rejected write. The fresh
verification used Node 22.13.0, `@sap/cds` 10.1.1, `@cap-js/sqlite` 3.1.2, and a
separate in-memory database. No ERP or cloud connection is involved.

## Initial data and development-only data

The [official CAP initial-data guide](https://cap.cloud.sap/docs/guides/databases/initial-data),
reviewed October 15, 2026, distinguishes `db/data` (initial data used in development
and production) from `test/data` (development only). This repository deliberately
places the sample project's rows in `db/data`; that is not a production-data
recommendation. The narration and companion draft preserve this distinction.

The [official OData feature overview](https://cap.cloud.sap/docs/guides/protocols/odata#feature-overview)
documents the query options. The lesson's exact responses are established by
the local live assertions. The export's companion draft links to the immutable
published commit containing the verified demo source.
