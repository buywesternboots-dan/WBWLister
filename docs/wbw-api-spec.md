# WBW Lister ↔ Western Boot World API specification

**Status:** Draft request to Western Boot World. Not implemented.  
**Date:** Monday, November 16, 2026, 1:50 AM ET (America/New_York)  
**From:** WBW Lister / BootLister (buywesternboots-dan/WBWLister)  
**For:** Western Boot World engineering (Ergon Insights)  
**Rule:** WBW Lister never writes to westernbootworld.com until WBW builds and approves this API. Public brand and boot lookups already allowed are read-only GET only.

Related BootLister sources used to write this (no live eBay calls; no sign-in or POST to westernbootworld.com):

- Item and seller schema: `lib/wbw.js` (`FIELDS`, `SELLER_FIELDS`)
- WBW “Sell a pair” CSV contract: `lib/export.js` (column names and order; do not add columns on the CSV path)
- Intake and WBW account field labels: `lib/wbw-account.js`, `lib/public-intake-constants.js`
- Public listing field reference: listing 298, captured read-only November 15, 2026 (see `/workspace/wbw-listing-sample.md`)
- WBW public video limits: `MAX_VIDEOS=1`, `MAX_VIDEO_SECONDS=30`, `MAX_VIDEO_MB=100`

---

## 1. Purpose

WBW Lister (BootLister) is the seller’s primary inventory tool — the home base. It already gathers a seller’s pairs from their other channels, normalizes western-boot fields, optimizes photos, and can export a WBW “Sell a pair” CSV. Sellers still have to create and keep their WBW accounts by hand, and there is no official way to push or sync inventory.

This API is what WBW Lister needs WBW to build so that we can:

1. Authenticate as a seller with a **per-seller API key or token, never the seller’s password**, so sync keeps working after a password change. One key per seller, scoped only to that seller’s inventory.
2. Look up **seller account setup and verification status**, and read required profile fields (contact preference, shipping policy, location, verified phone) and report what is missing.
3. **Import** a seller’s full inventory from their primary tool into WBW, with as many fields as possible, using idempotency keys and `external_id`.
4. **Keep WBW current** with the primary tool at all times: detect new, sold, and changed items (delta reads, `updated_since` cursors, ETags, mark-sold, delist).
5. Apply **per-seller dress-up** on the way in: photo optimization is standard for every seller; extra description information and video are separate opt-ins, controlled on the BootLister back end by WBW Lister admins, **not** by the seller.
6. Send the seller a **reminder** when sync finds an item sold on WBW or elsewhere that is still showing as active in their main inventory. Default is a WBW Lister-side notification. Optionally, WBW can own the same reminder via an endpoint or webhook.
7. Receive **notification alerts** when a seller gets a message from a buyer or other member (signed webhooks, with a polling fallback).

**Phase 1 (the current build)** is items 1-7, plus the secure handoff in section 15: per-seller keys, seller lookup/profile, inventory and sync, media, webhooks/events, optional reminders, and handoff.

8. **Phase 2 (later, not part of the current build).** Contribute verifiable maker and style data to the WBW boot database only — never to other site content. Exact maker plus full style/model-number match only (leading zeros kept; no fuzzy or partial matches), or a new maker/style backed by clear evidence such as a label photo. Additive only; never overwrite existing records. See section 10. Do not include this in the first WBW build.

Until WBW builds and approves this API, WBW Lister continues to use only public read-only GETs (makers library, `/lookup`, public listing pages) and the existing manual CSV / hand-setup path. Nothing here authorizes a sign-in, POST, or any change to westernbootworld.com itself.

---

## 2. Design principles

- HTTPS only. TLS 1.2+.
- Seller credentials are API keys, not passwords. A password change must not revoke the key.
- A seller key can only read and change that seller’s own account, profile, inventory, and events.
- Writes are idempotent (`Idempotency-Key` header and/or `external_id`).
- **Phase 2 (later, not part of the current build):** boot-database contributions use a separate app-level credential and the scope `boot_db:contribute` (never a seller key). Writes are additive only; conflicts are flagged for WBW review, never overwritten. Exact maker + full style/model match only; leading zeros in style numbers are preserved; no fuzzy or partial matches.
- Versioned under `/api/v1`. Breaking changes get a new version.
- A sandbox environment is requested for build and test, with separate credentials.

---

## 3. Auth model

Two kinds of credentials, neither of which is a seller password.

**App-level (WBW Lister as a partner).** WBW issues WBW Lister a `client_id` and `client_secret`. WBW Lister exchanges them for a short-lived partner access token (`POST /api/v1/oauth/token`, client credentials). That token is used to look up sellers, issue or rotate per-seller keys, and register webhooks. **Phase 2 (later, not part of the current build):** the extra scope `boot_db:contribute` will be used to submit boot-database contributions. The `client_secret` and the webhook signing secret are handed over through a secure channel (see [§15 Handoff](#15-handoff-to-wbw-lister-once-built)), never email or plain chat.

**Per-seller API keys.** After the seller consents to connect WBW Lister (a Connect screen on WBW, or an admin-assisted setup), WBW issues **one active API key per seller**, scoped only to that seller’s inventory and profile. The raw key is shown or delivered **once**. WBW stores only a one-way hash (SHA-256 or stronger), plus a prefix and last four characters for display. WBW Lister stores the key encrypted at rest, never in logs. The seller (or a WBW Lister admin acting with the partner token, after consent) can **rotate** or **revoke** the key. Rotation may keep the old key valid for a short grace period (recommend 24 hours) so in-flight sync is not dropped; revoke is immediate. Changing the seller’s WBW password does **not** revoke the API key — that is the point of this model. The seller can still revoke the key from their WBW account.

**How a request is authenticated.** Send `Authorization: Bearer <token>`. A seller key starts with `wbw_live_sk_` in production and `wbw_test_sk_` in sandbox. A partner access token is the short-lived token from the token endpoint. Missing or bad credentials return `401`. A valid key used on another seller’s resource returns `403`.

### 3.1 Scopes

| Scope | Who | What it allows |
| --- | --- | --- |
| `partner:admin` | App | Look up sellers, issue / list / rotate / revoke seller keys, manage app webhooks |
| `boot_db:contribute` | App | **Phase 2 (later, not part of the current build).** Submit and read boot-database contributions only. Never granted on a seller key. Do not implement this scope in the current build. |
| `seller:read` | Seller | Account, verification, profile, completeness |
| `inventory:read` | Seller | List and get listings |
| `inventory:write` | Seller | Create, update, and media upload |
| `inventory:sell` | Seller | Mark sold, delist |
| `events:read` | Seller | Poll events and member messages |
| `reminders:write` | Seller or app | Optional WBW-owned sold-still-active reminders |

Default seller key: `seller:read inventory:read inventory:write inventory:sell events:read`.  
Default app token: `partner:admin`. The scope `boot_db:contribute` is **Phase 2 (later, not part of the current build)** and should not be issued in Phase 1.

### 3.2 Rate limits

Return `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and on `429` a `Retry-After` header (seconds). Suggested starting limits (per key, per minute):

| Key | Reads | Writes | Notes |
| --- | --- | --- | --- |
| Seller | 300 | 60 | Media: 30 upload inits/min, 100 MB each |
| App / partner | 600 | 120 | Phase 2 later: boot-database 30 batches/min, max 100 records per batch |

---

## 4. Versioning, errors, pagination

**Versioning.** All endpoints live under `https://api.westernbootworld.com/api/v1` (production; exact host is WBW’s to choose) and a separate sandbox host. Additive fields are backward compatible. Breaking changes (renamed or removed fields, changed meaning, new required fields) require `/api/v2` and a documented deprecation window. Send `Sunset` and `Deprecation` headers when a version has an end date.

**Idempotency.** Mutating endpoints accept an `Idempotency-Key` header (a client-generated UUID, retained at least 24 hours). A replay with the same key and the same body returns the original result. A replay with the same key and a different body returns `409 idempotency_key_reused`. Listing writes also key off `external_id` (unique per seller).

**Conditional requests.** `GET` of a listing (and the list endpoint) returns `ETag`. `GET` with `If-None-Match` may return `304`. `PATCH` / mark-sold / delist should accept `If-Match`; a stale tag returns `412`.

**Pagination.** Cursor-based. List responses:

```json
{
  "data": [ ],
  "page": {
    "next_cursor": "eyJ0IjoiLi4uIn0",
    "has_more": true
  }
}
```

Pass `cursor` and optional `limit` (default 50, max 200). Do not use offset pagination for inventory sync.

**Error format.** Every error uses this body:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Size is required to publish a listing.",
    "details": [
      { "field": "size", "issue": "required" }
    ],
    "request_id": "req_01JABCD"
  }
}
```

| HTTP | `code` (examples) |
| --- | --- |
| 400 | `invalid_request`, `invalid_cursor` |
| 401 | `unauthorized` |
| 403 | `forbidden`, `insufficient_scope` |
| 404 | `not_found` |
| 409 | `conflict`, `idempotency_key_reused`, `external_id_conflict` |
| 412 | `precondition_failed` |
| 422 | `validation_error`, `profile_incomplete`, `video_limit` |
| 429 | `rate_limited` |
| 500 / 503 | `internal_error`, `unavailable` |

---

## 5. Endpoints

There are **24 Phase 1 endpoints** in the current build (including two optional reminder endpoints; the default reminder path does not require them — see [§9](#9-seller-reminders-sold-but-still-active-in-the-primary-tool)), plus **3 Phase 2 endpoints** for boot-database contributions ([§10](#10-boot-database-contributions--phase-2-later-not-part-of-the-current-build)). Phase 2 is later and is **not part of the current build**.

### 5.1 App token

#### `POST /api/v1/oauth/token`

Exchange the app-level `client_id` and `client_secret` for a short-lived partner access token.

```json
{
  "grant_type": "client_credentials",
  "client_id": "wbw_live_id_...",
  "client_secret": "wbw_live_secret_...",
  "scope": "partner:admin"
}
```

```json
{
  "access_token": "wbw_live_at_...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "partner:admin"
}
```

Recommend 1-hour expiry. Do not use the `client_secret` as a daily request credential.

### 5.2 Seller API keys

All four require the app token with `partner:admin`, and a prior seller consent (or an equivalent admin-assisted connect). The raw secret is returned **only** on issue and rotate.

#### `POST /api/v1/sellers/{seller_id}/api-keys`

Issue the seller’s key. Body may include `scopes` (subset of the default seller set) and `label` (e.g. `"WBW Lister"`). Response includes `id`, `prefix`, `last4`, `scopes`, `created_at`, and `token` (once). If a key already exists, return `409` and tell the client to rotate.

#### `GET /api/v1/sellers/{seller_id}/api-keys`

List metadata only: `id`, `prefix`, `last4`, `scopes`, `created_at`, `last_used_at`, `status` (`active` or `revoked`). Never the secret.

#### `POST /api/v1/sellers/{seller_id}/api-keys/{key_id}/rotate`

Issue a replacement token. Body may include `grace_seconds` (default 86400, max 7 days). Response is the new `token` (once) plus the time the old key stops working.

#### `DELETE /api/v1/sellers/{seller_id}/api-keys/{key_id}`

Revoke immediately. In-flight requests with the old key start returning `401`.

Sellers should also be able to revoke or rotate from their WBW account UI, without involving BootLister.

### 5.3 Seller account, verification, and profile

#### `GET /api/v1/sellers/lookup`

App token. Query: `email` or `username` (exactly one). Returns `seller_id`, `username`, `verification`, and a `found` flag. Do not reveal whether an email exists to unauthenticated callers; this endpoint is partner-only.

#### `GET /api/v1/sellers/{seller_id}`

Seller key (`seller:read`) or app token after the seller is connected. Returns account setup, verification, profile, and a completeness report of required fields.

```json
{
  "id": "sel_123",
  "username": "marclipton",
  "display_name": "Marclipton",
  "account": {
    "created_at": "2026-09-30T16:02:00-04:00",
    "apply_to_sell": "approved",
    "can_list": true
  },
  "verification": {
    "email_verified": true,
    "phone_verified": true,
    "phone_verified_at": "2026-10-01T10:00:00-04:00",
    "identity_verified": false,
    "status": "phone_verified"
  },
  "profile": {
    "location": "Tampa, FL",
    "location_country": "US",
    "contact_preference": {
      "channel": "wbw_messages",
      "public_phone": null,
      "public_email": null,
      "note": "Members should contact me through WBW messages."
    },
    "shipping_policy": "Ships to CONUS. Buyer pays calculated shipping.",
    "return_policy": "Returns accepted within 3 days of delivery if not as described.",
    "payment_options": ["PayPal (Friends & Family)", "Venmo"],
    "phone": { "e164": "+18135550100", "verified": true },
    "bio": "",
    "fun_fact": "",
    "aliases": "",
    "profile_photo_url": null
  },
  "completeness": {
    "ready_to_list": true,
    "missing": [],
    "required": [
      "contact_preference",
      "shipping_policy",
      "location",
      "verified_phone"
    ]
  }
}
```

`apply_to_sell` values: `not_started`, `pending`, `approved`, `rejected`.  
`verification.status` values: `unverified`, `email_verified`, `phone_verified`, `restricted`.

**Required profile fields** (Dan, November 16, 2026):

| Field | Notes |
| --- | --- |
| `contact_preference` | How a member should contact the seller (`wbw_messages`, `email`, `phone`, or `other` plus a short note). |
| `shipping_policy` | WBW’s “Shipping & return policies” box is **400 characters max**. If shipping and returns are separate in the API, WBW Lister will join them to fit. |
| `location` | Seller location (e.g. `Tampa, FL`). This is a seller-profile field, not a per-listing field. |
| `verified_phone` | A phone number WBW has verified. Presence of a number is not enough; `phone.verified` must be `true`. |

`completeness.missing` is an array of those required keys (and any other WBW-required keys) that are empty or unverified, so WBW Lister can show the seller exactly what to finish. This endpoint is read/check only. Profile edits can stay on WBW’s own account screens unless WBW later adds a write endpoint.

Webhook `seller.verification_changed` fires when verification or `apply_to_sell` changes.

### 5.4 Inventory import and ongoing sync

WBW Lister is the seller’s primary inventory tool. It **pushes** new and changed pairs to WBW and **pulls** WBW’s current state so it can see sales and edits that happened on WBW.

Statuses we need to round-trip, matching what the public listing model already uses: `draft`, `listed` (for sale), `sold`, `collection` (kept, not for sale), `delisted`.

#### `POST /api/v1/listings`

Seller key, `inventory:write`. Create one listing. Send `Idempotency-Key` and an `external_id` (unique per seller; recommended `bootlister:{item_id}` or `{source}:{source_id}`). A second create with the same `external_id` returns the existing listing (`200`) rather than a duplicate.

`publish`: `true` lists it for sale; `false` saves a `draft` (matches BootLister intake `import_mode` live vs drafts).

Request body is the [listing resource](#6-listing-resource-and-field-mapping). Response is the created listing, including WBW `id` and `external_id`.

#### `POST /api/v1/listings/bulk`

Same scopes. Body:

```json
{
  "listings": [ { "external_id": "bootlister:401", "title": "…", "publish": true } ]
}
```

Max 100 listings per call. Each element is applied independently. Response: `results` array with `external_id`, `id` or `error`, and `outcome` (`created`, `updated`, `unchanged`, `failed`). Send a batch-level `Idempotency-Key` as well.

#### `GET /api/v1/listings`

Seller key, `inventory:read`. Query parameters:

| Param | Purpose |
| --- | --- |
| `status` | `draft`, `listed`, `sold`, `collection`, `delisted`, or comma-separated |
| `updated_since` | RFC 3339 timestamp; only records with `updated_at` greater than this |
| `cursor`, `limit` | Pagination |
| `external_id` | Lookup by BootLister id |

Returns `ETag` on the page. This is the **delta / cursor** read WBW Lister will poll, in addition to webhooks.

#### `GET /api/v1/listings/{listing_id}`

One listing, including media and `external_id`. Supports `If-None-Match`.

#### `PATCH /api/v1/listings/{listing_id}`

Partial update of fields and media order. Honor `If-Match`. Do not use PATCH to mark sold or delist.

#### `POST /api/v1/listings/{listing_id}/mark-sold`

Seller key, `inventory:sell`. Body may include `sold_at`, `sold_channel` (`wbw` or `other`), and `note`. Sets status to `sold`. This is how WBW Lister tells WBW that the pair sold on another channel and should come down from the Trading Post.

#### `POST /api/v1/listings/{listing_id}/delist`

Seller key, `inventory:sell`. Body may include `reason` (`sold_elsewhere`, `removed`, `collection`, `other`) and `target_status` (`delisted` or `collection`). The listing id is kept; it is not hard-deleted.

When WBW itself marks a pair sold or changes a listing, it should fire `listing.sold` or `listing.changed` and those updates must show up in `GET /listings?updated_since=`.

### 5.5 Media

WBW limits already observed on the public site: **1 video**, **30 seconds**, **100 MB**. Photos: no documented hard cap in the public listing we sampled (listing 298 had 6). Recommend accepting at least 12 photos, JPEG/PNG/WebP, and one `video/mp4` (or `.mov`) within the limits above.

Because a 100 MB video should not go through a JSON post, uploads are two-step.

#### `POST /api/v1/listings/{listing_id}/media`

Init an upload. Body: `{ "type": "photo" | "video", "filename": "vamp.jpg", "content_type": "image/jpeg", "byte_size": 2400000, "position": 1 }`.

Response: `media_id`, `upload_url` (signed, short-lived PUT), `upload_headers`, `expires_at`. The client PUTs the bytes to `upload_url`.

A second video on a listing that already has one returns `422 video_limit`. A video longer than 30 seconds or larger than 100 MB returns `422 video_limit` with details. Video is only sent when a WBW Lister **admin** has opted that seller into video (see [§8](#8-per-seller-dress-up-admin-controlled)); WBW does not need to know about that flag, but it must accept the optional video field.

#### `POST /api/v1/listings/{listing_id}/media/{media_id}/complete`

Confirms the PUT finished. Response includes the stored `url`, `type`, `duration_seconds` (video), and `position`.

#### `DELETE /api/v1/listings/{listing_id}/media/{media_id}`

Removes that photo or video.

---

## 6. Listing resource and field mapping

This is the JSON object for create, bulk, get, and patch. Names on the left are the API fields we are asking for. “BootLister” is the column on an `items` row (`lib/wbw.js` `FIELDS` plus photos and source). “WBW CSV” is the current “Sell a pair” import column (`lib/export.js`). “Public listing” is the field as shown on a live WBW listing page.

| API field | Type | BootLister | WBW CSV | Public listing / notes |
| --- | --- | --- | --- | --- |
| `id` | string | — | — | WBW listing id (e.g. `298`) |
| `external_id` | string | `bootlister:{id}` or `{source}:{source_id}` | Source ID | Idempotency / sync key |
| `status` | enum | `review` / `published` / `pending` / `sold` / … | — | `draft` / `listed` / `sold` / `collection` / `delisted` |
| `item_type` | enum | `boot` (`boot` column) | Category (Boots / Belts) | Boots, or belts on `/market/belts` |
| `title` | string | `title` | Listing title | h1 |
| `description` | string | `description` | Description | Body paragraph. May include admin-opted extra info (see §8). |
| `seller_notes` | string | *(not stored today)* | — | Hidden when empty on the public page. Include so we can send it when we have it. |
| `price` | number | `wbw_price` (fallback `price`) | Asking price | Price. Currency USD. |
| `price_type` | string | *(not stored today)* | — | Optional; e.g. `firm`, `obo`. Not on the CSV path. |
| `source_price` | number | `price` | Source price | Optional, not shown publicly. |
| `brand` | string | `brand` | Brand | Specifics: Brand |
| `id_text` | string | `id_text` | Model / date codes | Style / model number. Preserve leading zeros. |
| `custom_made` | boolean | folded into Condition today | — | Prefer a real flag, not only Condition = “Custom Made”. |
| `sized_for` | string | `sized_for` (`Men` / `Women` / `Kids`) | Sized for (`Men's` / `Women's` / `Kids`) | Sized for |
| `size` | string | `size` | Size | Size |
| `size_estimated` | boolean | `size_estimated` | Size estimated | |
| `width` | string | `width` | Width (`AAA`/`AA`/`A` display as `A`) | Width (Standard, etc.) |
| `condition` | string | `condition` | Condition | New / Broken In / Custom Made |
| `material_type` | string | `material_type` | Material type | Exotic / Leather / Synthetic / Fabric |
| `material` | string | `material` | Material / hide | Material (Alligator, etc.) |
| `material_cut` | string | `material_cut` | Material specifics (cut) | Cut (Tail, Hornback, …) |
| `color` | string | `color` | Color | Color |
| `made_in` | string | `made_in` | Where made | Where made (El Paso, TX) |
| `keywords` | string or string[] | `keywords` | Keywords | Keyword chips |
| `toe` | string | `toe` | Toe | Often hidden when empty |
| `heel` | string | `heel` | Heel | |
| `sole` | string | `sole` | Sole | |
| `heel_height` | string | `heel_height` | Heel height | Measurements block |
| `sole_length` | string | `sole_length` | Sole length | |
| `sole_width` | string | `sole_width` | Sole width | |
| `shaft_circ` | string | `shaft_circ` | Shaft circumference | |
| `shaft_height` | string | `shaft_height` | Shaft height | |
| `shipping_type` | string | seller / intake `shipping_policy` | — | e.g. Ships to CONUS. Per-listing override optional; profile policy is the default. |
| `shipping_cost` | string | seller `ship_price` | — | Optional |
| `payment_options` | string[] | intake `payment_methods` | — | Preferred payment options |
| `photos` | array | `photos` | Photos (+ Image Alt Text) | Gallery. Each `{ url, position, alt }`. |
| `video` | object or null | *(placeholder today)* | *(no CSV column)* | At most one. `{ url, duration_seconds, byte_size }`. 30 s / 100 MB. |
| `website_url` | string | `source_url` (blank for facebook/depop/poshmark/ebay) | Seller Website Link | Optional |
| `location` | string | seller `location` | Seller Context uses it | Seller profile location, echoed on the listing |
| `published_at`, `updated_at`, `sold_at` | datetime | — | — | Needed for cursors and reminders |

Create example (fields omitted are treated as empty, not errors, except WBW’s own publish requirements):

```json
{
  "external_id": "bootlister:401",
  "publish": true,
  "item_type": "boots",
  "title": "Black Jack natural alligator, black, 12 D",
  "description": "Size 12 standard width, made in El Paso, TX. Excellent condition.",
  "price": 1000,
  "brand": "Black Jack",
  "id_text": "BJ-1234",
  "sized_for": "Men's",
  "size": "12",
  "width": "D",
  "condition": "Broken In",
  "material_type": "Exotic",
  "material": "Alligator",
  "material_cut": "Tail",
  "color": "Black",
  "made_in": "El Paso, TX",
  "keywords": ["Exotic"],
  "photos": [
    { "position": 1, "alt": "Black Jack alligator boots, pair standing" }
  ]
}
```

Photos in that example would normally be uploaded first (or immediately after create) through the media endpoints. A create may also accept already-hosted HTTPS photo URLs that WBW will fetch, if WBW is willing; media upload is the reliable path.

---

## 7. Webhooks and polling

WBW Lister needs automatic alerts when a seller receives a notification from a buyer or other member, and when inventory or verification changes. Prefer **webhooks**; always offer a **polling fallback**.

### 7.1 Webhook management

App token, `partner:admin`.

#### `POST /api/v1/webhooks`

```json
{
  "url": "https://bootlister.vercel.app/api/wbw/webhooks",
  "events": [
    "member_message.received",
    "listing.sold",
    "listing.changed",
    "seller.verification_changed",
    "listing.sold_still_active_at_source"
  ],
  "secret": null
}
```

If `secret` is omitted, WBW generates one and returns it **once**. That value is the webhook signing secret in the [handoff](#15-handoff-to-wbw-lister-once-built). Production and sandbox are separate subscriptions and secrets.

#### `GET /api/v1/webhooks`

List `id`, `url`, `events`, `status`, `created_at`, `last_delivery_at` — not the secret.

#### `PATCH /api/v1/webhooks/{webhook_id}`

Update URL, event list, or rotate the secret (`rotate_secret: true` returns a new secret once). Can also `status`: `active` or `paused`.

#### `DELETE /api/v1/webhooks/{webhook_id}`

Stop deliveries.

### 7.2 Delivery, signature, retries

Each delivery is `POST` to the subscribed URL with `Content-Type: application/json` and these headers:

| Header | Meaning |
| --- | --- |
| `X-WBW-Signature` | `sha256=<hex>` HMAC-SHA256 of the raw body, using the webhook secret |
| `X-WBW-Timestamp` | Unix seconds, to prevent replay. Reject if older than 5 minutes. |
| `X-WBW-Event` | Event type |
| `X-WBW-Delivery-Id` | Unique id for this attempt; used for dedupe |
| `X-WBW-Webhook-Id` | Subscription id |

Signature base string: `{timestamp}.{raw_body}`.

WBW Lister will respond `2xx` to acknowledge. Any other response, or a timeout, is a failure. Retry at least: 1 minute, 5 minutes, 30 minutes, 2 hours, 8 hours, 24 hours (or equivalent exponential backoff) and then mark the delivery failed. Include `X-WBW-Delivery-Id` so retries are idempotent on our side.

Event body shape:

```json
{
  "id": "evt_01J…",
  "type": "listing.sold",
  "created_at": "2026-11-16T01:44:00-05:00",
  "seller_id": "sel_123",
  "data": {
    "listing_id": "298",
    "external_id": "bootlister:401",
    "status": "sold",
    "sold_at": "2026-11-16T01:40:00-05:00"
  }
}
```

`member_message.received` `data` should include `conversation_id`, `message_id`, `listing_id` (if any), `from` (member public handle only, not email), `preview` (short, no full PII), and a URL the seller can open on WBW. Do not send payment account numbers or private addresses over the webhook.

`listing.sold_still_active_at_source` is **optional** and only used if WBW owns the reminder (see §9).  
**Phase 2 (later, not part of the current build):** `boot_db.contribution_accepted` / `boot_db.contribution_rejected` are used for boot-database submissions (see §10). Do not implement these events in Phase 1.

### 7.3 Polling fallback

#### `GET /api/v1/events`

Seller key `events:read`, or app token scoped to the connected sellers. Query: `types`, `since` (or `cursor`), `limit`. Returns the same event objects, in order, including member messages. WBW Lister will poll this if webhook delivery is down or not yet configured (recommend every 5 minutes as a fallback; more often is unnecessary if webhooks are healthy).

---

## 8. Per-seller dress-up (admin-controlled)

These flags live in **WBW Lister**, on the back end, set by WBW Lister admins. They are **not** seller-facing toggles and they are **not** WBW API settings. They are specified here so WBW knows what will appear on inbound listings.

| Flag | Default | Who sets it | Effect when pushing to WBW |
| --- | --- | --- | --- |
| Photo optimization | **On for every seller** | Standard; not optional | Photos may be cropped, color-corrected, renamed, and given alt text before upload. Originals are kept in BootLister. |
| Extra description info | **Off**, per-seller opt-in | WBW Lister admin only | When on, BootLister may append structured extras (maker note, measurements already in the table, brand context) to `description`. When off, the seller’s (normalized) description is sent as-is. |
| Video | **Off**, per-seller opt-in | WBW Lister admin only | When on, BootLister may upload one video (≤30 s, ≤100 MB). When off, no video is sent, even if we have one. |

WBW only needs to accept the resulting `description`, photos, and optional video. WBW does not need endpoints to read or write these flags.

---

## 9. Seller reminders (sold but still active in the primary tool)

When sync detects that an item **sold** (on WBW or on another channel) but is **still showing as active** in the seller’s primary inventory tool, the seller should get a reminder like: *“You sold this item but it's still showing on your main inventory.”*

### 9.1 Default — WBW Lister-side (no new WBW endpoint required)

WBW Lister owns this notification.

**Data needed from this API** (already covered above): `listing.sold` and `listing.changed` webhooks (or `GET /listings?updated_since=`), with WBW `id`, `external_id`, `status`, and `sold_at`. WBW Lister compares that to the item’s status in the primary tool.

**Trigger.** An item is `sold` on WBW (or marked sold on another source BootLister tracks) **and** the matching primary-tool item is still active (for sale / not pending-sold / not delisted).

**Dedupe.** One open reminder per seller + item (`external_id`). Never send a second first-notice for the same pair while that reminder is open.

**Repeat cadence.** First notice as soon as the mismatch is seen. If it is still open: again at 3 days, again at 7 days, then weekly, up to 4 notices. Stop earlier if it clears. Admins can mute further notices for that item.

**Channels.** Email and, if the seller has a phone on file and has agreed to SMS, SMS. Choice follows the seller’s BootLister contact preference. Copy is plain, for example: *“You sold this item but it's still showing on your main inventory.”* Include the title and a link into WBW Lister (and WBW, when we have the listing URL).

**Admin visibility.** WBW Lister admins can see open and cleared reminders per seller (item, sold channel, first/last notice, notice count, status).

**How it clears.** The reminder closes when the primary-tool item is marked sold, pending-sold, or delisted; when a WBW Lister admin or the seller dismisses it; or when the WBW (or other-channel) side is no longer sold / the mismatch is gone. Clearing the reminder does **not** auto-delist anything. The seller (or a later sync they approve) still updates the primary inventory.

### 9.2 Optional — if WBW wants to own it

If WBW would rather show the same reminder in WBW (bell, email, or SMS), two hooks are enough:

#### `POST /api/v1/sellers/{seller_id}/reminders`

```json
{
  "type": "sold_still_active_at_source",
  "listing_id": "298",
  "external_id": "bootlister:401",
  "sold_channel": "wbw",
  "sold_at": "2026-11-16T01:40:00-05:00",
  "message": "You sold this item but it's still showing on your main inventory."
}
```

Idempotent on `external_id` + `type` while open. Response includes `id` and `status` (`open` or `already_open`).

#### `GET /api/v1/sellers/{seller_id}/reminders`

Filter by `status=open`. WBW Lister will also treat a listing as cleared when a later push marks it sold or delisted, or it can PATCH/clear if WBW adds that. A webhook event `listing.sold_still_active_at_source` is an alternative to the POST if WBW prefers to be told “this happened” and then create the reminder itself.

These two endpoints are optional. The default path in §9.1 ships in WBW Lister regardless.

---

## 10. Boot-database contributions — Phase 2 (later, not part of the current build)

This entire section, its three endpoints, the `boot_db:contribute` scope, and the `boot_db.contribution_accepted` / `boot_db.contribution_rejected` webhooks are **Phase 2 (later, not part of the current build)**. WBW should not implement them in the first API delivery. They are specified now so the later contract is clear.

The WBW API should automatically accept verifiable data that WBW Lister gathers from sellers into the **WBW boot database only** — never into other site content (marketplace listings, community posts, seller bios, encyclopedia prose beyond the structured boot record, and so on).

WBW Lister itself **never writes to westernbootworld.com** until WBW builds and approves this API. After that, the only write path into WBW knowledge data is this contribution endpoint.

**Verifiable means:**

- **Exact** maker name plus **full** style / model-number match. No fuzzy matching, no partial model numbers, no “close enough” brands. Leading zeros in the style number are kept (`0123` stays `0123`, never coerced to `123`).
- **Or** a **new** maker or style, only when there is clear evidence (typically a label photo, plus the listing and a source URL).
- Confidence sent by WBW Lister is always `exact`. We will not submit guessed or partial facts.

### 10.1 `POST /api/v1/boot-database/contributions` — Phase 2 (later, not part of the current build)

App-level token **only**, scope `boot_db:contribute`. Not allowed on a seller key. Batch, with an `Idempotency-Key`. Max 100 records per call.

```json
{
  "contributions": [
    {
      "idempotency_key": "contrib_bootlister_401_BJ-0123",
      "maker": "Black Jack",
      "style_number": "BJ-0123",
      "confidence": "exact",
      "action": "add_facts",
      "facts": {
        "sized_for": "Men's",
        "material": "Alligator",
        "material_cut": "Tail",
        "made_in": "El Paso, TX",
        "toe": null,
        "heel": null
      },
      "provenance": {
        "seller_id": "sel_123",
        "external_id": "bootlister:401",
        "source_url": "https://example-seller.com/listings/401",
        "evidence": [
          { "type": "label_photo", "url": "https://…/label.jpg" }
        ]
      }
    }
  ]
}
```

For a new maker or style, set `action` to `new_maker` or `new_style` and include evidence. WBW should hold those for review rather than auto-publishing if that is WBW’s editorial practice; the API still accepts the batch and returns a per-row status.

### 10.2 `GET /api/v1/boot-database/contributions` — Phase 2 (later, not part of the current build)

App token, same scope. Filter by `status`, `cursor`, `limit`, or `idempotency_key`.

### 10.3 `GET /api/v1/boot-database/contributions/{contribution_id}` — Phase 2 (later, not part of the current build)

Status of one record: `accepted`, `duplicate`, `conflict_pending_review`, `rejected`, `pending`. Include a short `reason` when not `accepted`.

**Dedupe.** If the same maker + full style number (compare style numbers as exact strings, leading zeros included) already exists, attach additive facts to that record or return `duplicate` when the facts are already present. Replays of the same `idempotency_key` return the original result.

**Additive only.** Never overwrite an existing boot-database value. If a submitted fact conflicts with a stored fact (same field, different value), leave the stored value in place, mark the contribution `conflict_pending_review`, and flag it for WBW review. WBW editors resolve conflicts; WBW Lister does not.

**Webhooks.** `boot_db.contribution_accepted` and `boot_db.contribution_rejected` (rejected includes conflict-pending if WBW prefers a single “not published” signal, or WBW can send accepted only for facts that actually landed). Payload includes `contribution_id`, `maker`, `style_number`, `status`, and `reason`.

---

## 11. Public read-only lookups (already allowed)

No new permission is requested for:

- The public makers / brand library
- `/lookup` and other public boot-database **reads**
- Public listing and market pages

WBW Lister will keep using those as **GET only**. It will not sign in, post, hold, message, or change anything on westernbootworld.com. This API is the only future write path. **Phase 2 (later, not part of the current build):** boot-database writes go only to the boot database.

---

## 12. Sandbox environment

Please provide a sandbox (or staging) that mirrors this API:

- Separate base URL, e.g. `https://api.sandbox.westernbootworld.com/api/v1`
- Separate `client_id` / `client_secret`, seller test keys (`wbw_test_…`), and webhook secret
- Test seller accounts (one unverified, one phone-verified and approved to list)
- Ability to fire test webhooks, including `member_message.received` and `listing.sold`
- Data isolated from production marketplace listings and from the production boot database
- Rate limits may be lower

WBW Lister will build and test against sandbox first. Production credentials are a separate handoff.

---

## 13. Security and privacy

- HTTPS only. No keys or PII in query strings.
- Hash seller API keys at rest; show the raw secret once. Encrypt tokens WBW Lister stores.
- Never accept or store a seller’s WBW password.
- Partner `client_secret` and webhook secret are delivered only through the secure handoff in §15 — never email, SMS, or plain chat.
- Scopes are enforced on every request. `boot_db:contribute` is app-only and is **Phase 2 (later, not part of the current build)**.
- Webhook signatures are HMAC-SHA256 with a timestamp window. Endpoints should reject unsigned or stale deliveries.
- Least PII on event payloads: public handle and a short preview, not emails, phone numbers, or payment details.
- Log `request_id`, seller id, and outcome; never log full secrets or raw Authorization headers.
- Sellers can revoke their key in WBW. Revoke is immediate.
- Retention: listing and contribution data kept as needed to operate the marketplace and boot database; honor a seller’s deletion request on a documented timeline.
- WBW Lister will not use WBW data to train public models and will not write to any WBW surface except the endpoints in this spec, once approved.

---

## 14. What WBW Lister will do on its side (for context)

Not WBW work, but useful context:

- Phone-sheet intake already collects profile answers and creates a BootLister seller. Shipping, returns, and payment are collected there today; WBW’s 400-character policy box is composed from those answers for hand setup. This API’s profile completeness check replaces the guesswork after a seller has a WBW account.
- Photo optimization already runs on import. Video is a placeholder until an admin opt-in and this API’s media upload exist.
- Sync inside BootLister today is source → BootLister (new / changed / pending sold). There is not yet a recorded “last sent to WBW” cursor. This API’s `external_id`, ETags, and `updated_since` are what make WBW a live destination.
- Exact-only maker/style matching is already BootLister policy for optimization. The same rule will apply to Phase 2 boot-database contributions (later, not part of the current build).
- No live eBay API calls are part of this request.

---

## 15. Handoff to WBW Lister once built

This is how the built API gets into WBW Lister’s hands. Keep it plain. Do not send secrets by email, SMS, Slack, or any other plain chat.

### What WBW sends back

1. **Production API base URL** (for example `https://api.westernbootworld.com/api/v1`) and a one-page endpoint list (or a pointer to this spec, if it is the contract).
2. **Sandbox base URL** (for example `https://api.sandbox.westernbootworld.com/api/v1`).
3. **App-level `client_id` and `client_secret`**, one pair for sandbox and a separate pair for production.
4. **Webhook signing secret**, again separate for sandbox and production (or WBW Lister will create the subscription and receive the secret once from `POST /webhooks`).
5. Any sandbox test-seller logins or IDs needed to try connect, list, sell, and messages.
6. A contact on the WBW side for outages and version changes.

### How those secrets travel

- **Never** put `client_secret` or the webhook secret in email, a ticket comment, Slack, SMS, or a shared doc.
- Preferred: a WBW Lister admin (Dan, or a named deputy) **types them into Vercel environment variables** for the BootLister projects (`wbw-lister` and the bootlister.vercel.app project), in both Preview/Sandbox and Production as appropriate, then destroys the one-time copy.
- Also fine: WBW sends a **one-time secure link** (short expiry, single use, only the named admin can open it). The admin copies the values into Vercel, then the link expires. The link is not a standing password page.
- If a secret may have been exposed, WBW rotates it and does a fresh handoff the same way. Do not resend the old value.

Suggested Vercel names (WBW Lister will set these once the values arrive):

| Env var | Value |
| --- | --- |
| `WBW_API_BASE_URL` | Production base URL |
| `WBW_API_SANDBOX_URL` | Sandbox base URL |
| `WBW_CLIENT_ID` | App `client_id` (sandbox or production, per environment) |
| `WBW_CLIENT_SECRET` | App `client_secret` |
| `WBW_WEBHOOK_SECRET` | HMAC secret for that environment |

### How WBW Lister then uses them

**Seller connect.** In WBW Lister, the seller (or Dan helping them) starts “Connect Western Boot World.” WBW Lister uses the app token to look up the WBW account and, after the seller consents on WBW, to issue the per-seller API key. That key is stored encrypted in BootLister and used for all inventory and profile calls. The seller’s WBW password is never collected. If they later change that password, sync keeps running until they revoke the key.

**Sync schedule.** After connect, WBW Lister pushes new and changed pairs (bulk upsert, media upload, mark-sold, delist) and pulls `GET /listings?updated_since=` on a regular schedule (about every 15 minutes is the starting point, tighter if webhooks are late). Webhooks `listing.sold` and `listing.changed` wake the same path immediately. Sold-but-still-active reminders run off those results as in §9.

**Webhooks.** WBW Lister exposes an HTTPS endpoint (for example `https://bootlister.vercel.app/api/wbw/webhooks`). It is registered with `POST /webhooks`. Each delivery is checked with HMAC-SHA256 and the `WBW_WEBHOOK_SECRET` (and the timestamp window). If signatures fail or deliveries stop, WBW Lister falls back to `GET /events`. Production and sandbox use different URLs or a path prefix, and different secrets.

**Phase 2 boot database (later, not part of the current build).** After Phase 2 is approved, and only with a token that includes `boot_db:contribute`, WBW Lister will submit exact, evidenced contributions. Nothing is written to any other WBW surface. This is not part of the Phase 1 handoff or first production use.

**Sandbox first.** WBW Lister will confirm connect, import, sync, reminders, and webhooks against the sandbox URL before any production client secret is used. Phase 2 contributions are tested later, when that work starts.

---

## 16. Build prompt

The following is a copy-pasteable prompt for WBW’s engineering team (or their coding agent) once they agree to build this API. It restates the contract; it does not add requirements.

> Build a versioned HTTPS API (`/api/v1`) for Western Boot World that WBW Lister / BootLister will use as the only write path into WBW. Do not change westernbootworld.com until this API is built and approved. Public makers-library and `/lookup` reads stay as they are (GET only).
>
> **Auth.** Support an app-level `client_id` / `client_secret` exchanged at `POST /api/v1/oauth/token` (client credentials) for a short-lived partner token, and one hashed-at-rest API key per seller (prefix `wbw_live_sk_` / `wbw_test_sk_`), issued, listed (metadata only), rotated, and revoked by the partner after seller consent. Never accept the seller’s password. A password change must not revoke the seller key. Scopes: `partner:admin`, `seller:read`, `inventory:read`, `inventory:write`, `inventory:sell`, `events:read`, optional `reminders:write`. Enforce scopes, rate limits, and `Authorization: Bearer`.
>
> **Sellers.** `GET /api/v1/sellers/lookup` (by email or username, partner only) and `GET /api/v1/sellers/{seller_id}` returning account setup, apply-to-sell status, verification (including verified phone), profile, and a `completeness` object whose required fields are contact preference (how a member should contact them), shipping policy (400 character max, matching WBW’s shipping & return policies box), location, and verified phone, plus `missing` for anything not set.
>
> **Inventory.** Listing JSON should cover the WBW listing fields (title, description, seller notes, price, optional price type, brand, model/style `id_text` with leading zeros preserved, custom made, sized for, size, size estimated, width, condition, material type, material, cut, color, where made, keywords, toe, heel, sole, five measurements, shipping, payment options, photos, at most one video ≤30 seconds and ≤100 MB, website URL, timestamps). Identify records by WBW `id` and client `external_id`. Endpoints: `POST /listings`, `POST /listings/bulk` (idempotent, max 100), `GET /listings` (filter `status`, `updated_since`, cursor, ETag), `GET /listings/{id}`, `PATCH /listings/{id}` (If-Match), `POST /listings/{id}/mark-sold`, `POST /listings/{id}/delist`, and two-step media upload (`POST .../media`, `POST .../media/{id}/complete`, `DELETE .../media/{id}`).
>
> **Webhooks and poll.** Partners register `POST/GET/PATCH/DELETE /api/v1/webhooks`. Deliver HMAC-SHA256 signed POSTs (`X-WBW-Signature` over `{timestamp}.{body}`, `X-WBW-Timestamp`, `X-WBW-Event`, `X-WBW-Delivery-Id`) with retries and backoff for: `member_message.received`, `listing.sold`, `listing.changed`, `seller.verification_changed`, optional `listing.sold_still_active_at_source`. Provide `GET /api/v1/events` as a polling fallback with the same event objects.
>
> **Reminders (optional on the WBW side).** WBW Lister will, by default, email/SMS the seller when sync shows an item sold on WBW or elsewhere but still active in the seller’s primary inventory, with dedupe, a 3-day / 7-day / weekly cadence, admin visibility, and clear-on-delist. If WBW wants to own that notice, also build `POST` and `GET /api/v1/sellers/{id}/reminders` and/or the `listing.sold_still_active_at_source` event. Do not auto-delist the source item.
>
> **Phase 2 comes later** (boot-database contributions, the `boot_db:contribute` scope, and `boot_db.contribution_*` webhooks). It is not part of this build; see section 10 of the spec when that work starts.
>
> **Platform.** Standard error envelope (`error.code`, `message`, `details`, `request_id`). Cursor pagination. Idempotency-Key on writes (24 hour retention). Sandbox host with separate credentials and test sellers. Rate-limit headers and 429 + Retry-After.
>
> **Handoff to WBW Lister once built.** When the API is ready, send WBW Lister: production base URL, sandbox base URL, the endpoint list (this spec), sandbox and production `client_id` / `client_secret`, and webhook secrets. Deliver secrets only through a secure channel — never email or plain chat. Preferred: a WBW Lister admin enters them into Vercel env vars (`WBW_API_BASE_URL`, `WBW_API_SANDBOX_URL`, `WBW_CLIENT_ID`, `WBW_CLIENT_SECRET`, `WBW_WEBHOOK_SECRET`), or WBW issues a one-time secure link the admin opens and then copies into Vercel. After that, WBW Lister will: (1) connect sellers via WBW consent and a per-seller API key (never a password), (2) run a recurring sync (push listings / mark-sold / delist, pull `updated_since`, about every 15 minutes, plus webhooks), (3) verify inbound webhooks with the HMAC secret and fall back to `GET /events`, (4) test on the sandbox URL before using production secrets. Rotate any exposed secret through a fresh secure handoff.
>
> Dress-up flags (photo optimization always on; extra description and video as admin-only opt-ins) live in WBW Lister, not in this API. Just accept the photos, description, and optional video we send.

---

## 17. Open questions for WBW

1. Preferred production and sandbox hostnames, and whether the API sits on `api.westernbootworld.com` or another host.
2. Whether listing create may pass existing HTTPS photo URLs for WBW to fetch, or media must always be a signed upload.
3. Maximum photos per listing, allowed image types, and whether alt text is stored.
4. Whether WBW wants to own sold-still-active reminders (§9.2) or leave them entirely to WBW Lister.
5. **Phase 2 (later, not part of the current build):** editorial workflow for new maker/style contributions — auto-accept exact additive facts on known styles, and review-queue everything else?
6. Token lifetime for the partner access token, and whether seller keys can have a grace period on rotate (24 hours recommended).
7. Any additional profile fields WBW requires before a seller can list, so we can add them to `completeness.required`.

---

*End of specification. Draft only; no implementation work on westernbootworld.com is requested until WBW agrees and this API is approved.*
