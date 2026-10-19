# Face Search — Apps Script 7.5

Clean source snapshot exported on 19 October 2026 (Asia/Bangkok).
Prepared by Codex / GPT-6 (exact subversion unknown).

The existing gallery is hosted by Google Apps Script. Images and generated indexes remain in Google Drive; this repository contains source code and synthetic/local contract tests only.

## Included

- Existing v10.4 source: `Routing.gs`, `Index.html`, `DatabaseService.gs`, `AvatarService.gs`, `Helper.gs`, `SyncReport.gs`, `appsscript.json`.
- Prepared Next.js read gateway: `WebApi.gs` (signed POST, read-only action allowlist, timestamp and replay checks).
- `PhotoHierarchy.gs` derives the legacy date/year hierarchy rules. A parity test compares it to the current Index helpers.
- Local tests in `tests/`. `node --test tests/web-api.test.cjs` exercises the new gateway with fixtures; no live Drive mutation.

## Verification — 19 October 2026

24 local tests passed with 0 failures: the new gateway contract and hierarchy parity tests plus legacy face classification, dynamic badges, image loading, parent folders and startup regression tests. These use synthetic/local mocks; authenticated live Next/GS integration and production deployment have not been run.

```sh
node --test tests/web-api.test.cjs tests/face-count.test.cjs tests/filter-dynamic-badges.test.cjs tests/photo-loading.test.cjs tests/photo-parent-folder.test.cjs tests/startup-v92.test.cjs
```

## Local deployment

Copy `.clasp.example.json` to `.clasp.json` and insert the authorized Script ID locally. Authenticate clasp on your machine. For the prepared gateway, configure `NEXT_PHOTO_GATEWAY_SECRET` in Script Properties to match the Next server's `PHOTO_GATEWAY_SECRET`. Never put either secret in Git or browser code.

GitHub upload does not deploy Apps Script. Source push, version creation and updating an existing deployment require a separate reviewed release. The prepared gateway is not claimed to be deployed or live-tested.

## Export boundary

The original local Git history contains tracked credentials and a SQLite face database. It was deliberately NOT pushed. This clean repository starts a new source-only history; the original project files and its local history are unchanged. Credentials, database/face vectors, temporary pulls, nested student project and machine deployment metadata are excluded. Do not push the original local history to this repository.
