# CAP inventory demo

Run `npm ci` from the repository root, then `npm run demo`. The workspace uses pinned `@sap/cds` 10.1.1 and `@cap-js/sqlite` 3.1.2 dependencies, with Node.js 22.13+ providing the SQLite driver. No global `cds` installation is needed.

The files required for the API are:

- `db/schema.cds`: `demo.Products` with UUID key, title, and stock.
- `srv/inventory-service.cds`: an explicit service projection. The relative `@path: 'inventory'` keeps the `/odata/v4` protocol prefix. `@requires: 'any'` deliberately allows anonymous reads for this local example; `@readonly` belongs on the projected entity.
- `db/data/demo-Products.csv`: three seed rows, including one product with zero stock.
- `package.json`: an in-memory development database and the runtime command.

Endpoints:

```text
http://localhost:4004/odata/v4/inventory/$metadata
http://localhost:4004/odata/v4/inventory/Products?$orderby=title
http://localhost:4004/odata/v4/inventory/Products?$filter=stock%20gt%200&$select=title,stock&$orderby=title
```

The last query returns the keyboard (12) and dock (7). OData includes their key fields in the response as well. Restarting the demo resets the database.

Run `npm run test:demo` at the repository root for live HTTP assertions. The verifier runs in a separate process on an ephemeral port, forces its database to local in-memory SQLite, and closes the HTTP server and database on exit. Its metadata, seed, filter, missing-row, and read-only checks must all pass before an episode preview can be generated.

This demonstrates a local query service. It does not demonstrate Fiori preview, authentication, ERP connectivity, cloud deployment, or production readiness.

Official references, checked October 14, 2026: [Services & APIs](https://cap.cloud.sap/docs/guides/services/providing-services), [SQLite for development](https://cap.cloud.sap/docs/guides/databases/sqlite), and [CAP server bootstrapping](https://cap.cloud.sap/docs/node.js/cds-server).
