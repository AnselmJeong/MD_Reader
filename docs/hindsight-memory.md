# Hindsight memory — 2026-10-16

The installed MD Reader uses `https://hindsight.ecoplay.cloud`, bank ID **MD-reader**. The original localhost address below describes the initial setup only. The existing `hindsight-local` server was healthy; the bank was created and a real, explicitly requested provider/memory preference was retained and recalled. The server and other banks were not reconfigured.

Settings → Hindsight Memory exposes Server URL, Memory Bank ID, optional bearer API key, key clearing, extraction/injection toggles, and the subscription extractor model. Save & Connect creates the bank if absent. Server URLs support reverse-proxy path prefixes. API keys stay in the main process and status exposes only a saved-key boolean. Environment overrides are `MD_READER_HINDSIGHT_BASE_URL`, `MD_READER_HINDSIGHT_API_KEY`, `MD_READER_HINDSIGHT_BANK_ID`.

## Flow

1. Conversations remain in local SQLite. On session finalization, GPT/Claude subscription extraction separates stable USER profile entries, proposed SOUL directives, and reusable insights.
2. USER.md remains local; SOUL changes remain in the review queue.
3. Curated insights use `POST /v1/default/banks/{bank_id}/memories` with synchronous completion, per-insight deterministic document IDs, provenance, string-valued metadata and the `md-reader` tag. Whole transcripts/documents are not retained.
4. Chat uses `/memories/recall`, a low budget and 1,200-token maximum. The resulting bounded block joins the local profile context. Recall has a 20-second deadline and respects chat cancellation; an unavailable server does not prevent document chat.
5. Failed Hindsight retains remain in the SQLite audit table and retry on the next successful startup. A stable document ID prevents retry-created documents with new IDs. Health uses bank stats without an LLM recall.

## Migration

- Retired mem0 URL, auth mode, user ID and credentials are removed from app settings. No mem0 request path remains.
- SQLite migration `hindsight-v1` is transactional and repeat-safe. It changes `mem0_id` to a provider-neutral remote document ID and maps old successful status to `stored`, with explicit `legacy_mem0` provenance.
- All 601 historical audit items survived on the real profile: 134 applied, 22 failed, 118 queued, 206 rejected, 121 stored. These are retained historical records, not a claim that old mem0 memories were copied into Hindsight.
- Old failed mem0 writes are not retried against Hindsight. Startup does not extract the entire historical conversation backlog after switching providers; recent/new sessions use the new provider.
- Original settings, database and installed app were backed up before installation. See `.tmp/hindsight-install.json` for the backup path and installed bundle hash.

## Verification

`npm run test:memory` covers retired credential cleanup, settings preservation, bank creation, reverse-proxy paths, bearer auth, health, retain response validation, deterministic IDs, metadata conversion, recall, auth errors, cancellation, invalid URLs, key clearing, and SQLite migration/restart. It also checks the duplicate-open EPUB context regression.

Live evidence:
- Bank created; synchronous retention completed.
- Real recall returned the retained preference, including Hindsight and MD-reader; warmed adapter recall took 1.17 seconds.
- `buildMemoryContextForPrompt` on the real profile included five recalled insights with no retrieval error.
- Installed settings showed Hindsight connected and both subscription accounts still logged in.
- Finalizing the real GPT reading-verification conversation completed extraction with zero insight writes, correctly avoiding storing document facts as reusable memory.

API contracts were checked against Context7 `/vectorize-io/hindsight` and the running server's OpenAPI schema (which is authoritative for its installed version).

## Installed artifact

- Final app: `/Applications/MD Reader.app`.
- app.asar SHA-256: `20d8bfaaf63753c9c4cdc20670910592da75dfe513c61f05f7b1138b1d1295a5`.
- Backup: `/Users/anselm/Library/Application Support/md-reader-backups/20261016-230921-hindsight`.
- Final restart preserved the configured server and bank, showed Hindsight connected, and retained both subscription logins.

## Remote access correction — 2026-10-17

The external hostname serves Hindsight Control Plane. `/v1/default/banks/...` on that hostname returned an HTML 404 even though `/api/banks` listed the existing MD-reader bank. MD Reader previously only understood the direct API protocol.

The client now probes read-only bank-list endpoints on the configured origin and supports both direct API (`/v1/default/...`) and Control Plane proxy routes (`/api/stats/{bank}`, `/api/banks`, `/api/memories/retain`, `/api/recall`). It keeps the configured origin throughout; no localhost fallback or new publicly exposed server endpoint is used. Both protocols retain source document IDs and explicitly target the selected bank.

Existing banks are checked read-only. Settings are validated against the server before they replace the saved connection, so failed saves preserve the previous destination and credentials. Disabling memory remains possible offline. Enter a server root URL, without `/dashboard`.

Tests cover both protocols, existing-bank read-only connection, bank creation, metadata and bank scoping, HTML responses, malformed JSON contracts, failed-save preservation, and offline disable. Typechecks and production build pass.

Remote live verification: HTTPS bank connection and synchronous retention passed; recall retrieved the newly retained external-access requirement in 3.57 seconds. The first cold recall exceeded the 20-second client budget (server completed in about 41 seconds); subsequent retrieval succeeded. This latency is separate from the corrected 404 routing failure.

Installed artifact SHA-256: `015d82880f8175658cf1cc40861faacb4f93e9a3e71b0e145e64981e1f7ca999`. Previous app and connection settings: `/Users/anselm/Library/Application Support/md-reader-backups/20261017-053555-remote-hindsight`.
