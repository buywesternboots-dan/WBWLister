# What to request from Western Boot World

Short list for WBW (Ergon Insights). Full contract: `docs/wbw-api-spec.md` in WBWLister (draft PR). WBW Lister will not write to westernbootworld.com until this API is built and approved. Public brand and boot lookups stay read-only GET. Phase 1 (the current build) is items 1–6, 8, and 9: per-seller keys, seller lookup/profile, inventory and sync, webhooks/events, optional reminders, sandbox, and handoff. Item 7 is Phase 2 (later, not part of the current build).

1. **Per-seller API keys, never passwords.** One key per seller, scoped only to that seller’s inventory. Issue, rotate, and revoke. Hash keys at rest. Sync must keep working after the seller changes their password.

2. **Seller lookup, verification, and profile completeness.** An endpoint to find the account and to read setup / verification status, including the required fields: contact preference (how a member should contact them), shipping policy (WBW’s 400-character limit), location, and verified phone — and to report what is missing.

3. **Inventory import and ongoing sync.** Pull/push the seller’s full inventory with as many listing fields as possible (including one video, 30 seconds, 100 MB). Bulk create with idempotency keys and `external_id`. Delta reads (`updated_since`, cursors, ETags), mark-sold, and delist so WBW stays current with the seller’s primary inventory tool.

4. **Signed webhooks, plus a poll fallback.** HMAC-SHA256, retries, and events including `member_message.received`, `listing.sold`, `listing.changed`, and `seller.verification_changed`. `GET /events` when webhooks are down.

5. **Dress-up stays on our side.** Photo optimization is standard for every seller. Extra description info and video are separate opt-ins controlled by WBW Lister admins, not by the seller. WBW only needs to accept the photos, description, and optional video we send.

6. **Sold-but-still-listed reminders.** When sync sees an item sold on WBW or elsewhere that is still showing as active in the seller’s main inventory, WBW Lister will remind them (default). If WBW wants to own that notice, add `POST /sellers/{id}/reminders` and/or event `listing.sold_still_active_at_source`.

7. **Phase 2 (later, not part of the current build): boot-database contributions only — never other site content.** `POST /api/v1/boot-database/contributions` (batch, idempotency key, provenance, confidence `exact`). Exact maker plus full style/model-number match only (leading zeros kept; no fuzzy or partial), or a new maker/style with clear evidence such as a label photo. Additive only; never overwrite; flag conflicts for WBW review. App-level scope `boot_db:contribute` (not a seller key). Webhooks `boot_db.contribution_accepted` / `rejected`. Do not include this in the first WBW build.

8. **Sandbox, errors, pagination, versioning.** A sandbox URL with separate credentials; `/api/v1`; cursor pagination; a standard error body; rate limits.

9. **Secure handoff once built.** Send production and sandbox base URLs, the endpoint list, app-level `client_id` / `client_secret`, and webhook secrets through a secure channel only — never email or plain chat. A WBW Lister admin will enter them into Vercel env vars, or open a one-time secure link and then store them there. We will use them for seller connect, a recurring sync, and webhook verification, and we will test in sandbox first.

10. **Leave the public site as-is until then.** Read-only public lookups of the brand and boot database are already allowed. Please do not treat this request as permission to have WBW Lister post or change westernbootworld.com.
