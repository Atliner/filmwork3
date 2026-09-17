# KV storage and maintenance

## Stable records (no destructive migration required)

- `it:<id>`: one primary movie/series record, including seasons, episodes, variants and gallery. Edits replace that value.
- `u:<username>`: one primary user record, including wallet, subscription and bounded transaction history. Edits replace that value.
- `code:<code>`: one gift-code record. Usage updates that record; deleting the code deletes its primary record.
- `idx`: shared catalogue index, needed to display/filter the catalogue without reading every movie.
- `src:*`, `tg:*`, `ph:*`, `tgu:*`, `refcode:*`: small lookup indexes, not copies or edit history. Removing all of these would require costly scans for login, imports and transfers.
- `tick:*`, `tgstate:*`, `dl:*`, caches and rate-limit records are temporary records. Existing expiration policies remain in force.
- Payment records are separate business events, not user revisions. They are not purged by the orphan cleanup tool. Existing payment retention/expiration remains unchanged.

This is an incremental KV improvement, not a migration to a transactional database. KV does not provide atomic multi-record updates or globally immediate reads. This patch cannot guarantee avoidance of plan limits, exact concurrent balances or immediate deletion visibility across all regions.

## Changes

1. Request-local read deduplication (including concurrent reads), using immutable serialized snapshots.
2. Skip identical writes when a key has already been read in the request. TTL writes still refresh expiration.
3. Propagate storage errors: failed writes/deletes must not be reported as successful.
4. KV list pagination; the old implementation silently stopped after the first page.
5. User updates write only changed/new lookup indexes and delete old owned indexes. Unchanged wallet updates no longer rewrite phone/handle indexes.
6. Content edits remove detached source indexes (public and private channels) and detached subtitle records. Indexes reassigned to another item are protected.
7. Content deletion removes known source indexes, subtitles, legacy view records, the primary record and its catalogue entry. User deletion removes known lookup indexes and Telegram signup state.
8. Best-effort view persistence interval increased from one to five minutes per worker instance; views no longer rewrite the entire catalogue index. Counts are approximate and can lag or be lost on worker eviction; this is not a billing metric.

## Existing orphan records

Admin Settings → KV Maintenance provides explicitly requested, ten-key batches:

1. Make an independent backup of the namespace first. The tool does **not** create a backup.
2. Pause imports/restores and avoid running cleanup during new account/content creation. Wait several minutes after recent changes because KV reads are eventually consistent.
3. Select an index group and inspect a batch. Inspection does not write/delete anything.
4. Confirm deletion of the listed orphan keys, or move to the next batch.
5. The delete request re-checks dependencies; records that now have a parent are skipped.

The tool only deletes supported orphan indexes, orphan subtitles, and obsolete statistics. It never automatically deletes primary users, movies, codes, settings, or financial records. Existing aliases pointing to a live parent are retained conservatively. Historical payment details, embedded referral/code usage and pending temporary tokens are not comprehensively erased by deleting a user; a full privacy-erasure workflow needs a separate, explicit retention policy.

Each batch is deliberately small to limit KV calls and Worker subrequests. Scanning a namespace itself consumes list/read operations: run manually, not on a timer. Very large admin user/code lists still need UI pagination in a future change; full listing is correct now but not free.

## Validation

Run `node tests/check.mjs` and `node --input-type=module --check < worker.js`.
Tests cover read coalescing and snapshot isolation, unchanged writes, TTL refresh, multi-page listing, propagation of quota/network errors, stable user/item keys, differential index cleanup, preview-only scans, dependency re-check and protection of financial/primary records.

No live namespace has been modified by these local tests. Deploy to a staging Worker/KV first, test login, editing/deleting disposable content/users and payments, then monitor Cloudflare read/write/list usage before enabling maintenance in production.
