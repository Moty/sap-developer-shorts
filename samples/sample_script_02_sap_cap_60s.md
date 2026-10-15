# Episode CAP-01: Your CAP model needs a service

Revision 2. Canonical editorial input: [CAP-01.json](../content/episodes/CAP-01.json). Generate a fresh storyboard and HTTP evidence with `npm run pilot`.

- **Audience:** Full-stack developers new to SAP CAP
- **Planned duration:** 55 seconds; 126 spoken words. Measure audio before final scene alignment.
- **Setup:** Node.js 22.13+, `npm ci`, checked-in inventory project. Installation happens before recording.
- **Demonstrated scope:** Local read-only OData V4 prototype with an in-memory SQLite database.

## Complete code

`demos/cap/inventory/db/schema.cds`

```cds
namespace demo;

entity Products {
  key ID : UUID;
  title  : String(100);
  stock  : Integer;
}
```

`demos/cap/inventory/srv/inventory-service.cds`

```cds
using { demo } from '../db/schema';

@path: 'inventory'
@requires: 'any'
service InventoryService {
  @readonly
  entity Products as projection on demo.Products;
}
```

## 0–3s · Where's the API?

Your data model isn't an API.

Visual: Presenter intro.

## 3–10s · The missing service definition

A CAP entity describes data. Add an explicit service projection to expose it. Start with this prepared inventory project.

Visual: The data model.

## 10–20s · 1. Define the data

First, define Products with an ID, title, and stock count. Three rows of sample data are already in the project.

Visual: db/schema.cds.

## 20–30s · 2. Expose a service

Next, expose that entity through InventoryService. This explicit service definition creates the API. The read-only annotation keeps this example focused on queries.

Visual: srv/inventory-service.cds.

## 30–40s · 3. Run and query

Run npm run demo. Open this local Products URL, then filter for stock above zero. You get our keyboard and dock.

Visual: Run the demo, then open the URL.

```text
npm run demo
http://localhost:4004/odata/v4/inventory/Products?$filter=stock%20gt%200
```

## 40–48s · Verified local results

You have a local OData version four endpoint with real sample results. This is a development prototype; deployment and authentication come later.

Visual: GET Products · three seeded rows.

## 48–55s · Try the checked-in demo

Grab the working project and its checks from the repository. Which entity would you expose first?

Visual: Presenter closing.

## Run and inspect

```sh
npm run demo
npm run test:demo
```

The stock filter returns the keyboard (12) and dock (7), including OData key fields. The verifier also asserts metadata, all three seed rows, 404 for a missing product, and 405 for a create request.

The storyboard illustrates source code and presents captured response fields. It is not execution footage or a finished video. Presenter, voice, aligned captions, and final media checks are pending.

Sources: [SAP provided services](https://cap.cloud.sap/docs/guides/services/providing-services), [SAP SQLite development guide](https://cap.cloud.sap/docs/guides/databases/sqlite).
