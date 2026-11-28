# WBW API for Bootlister

This is a connection on the WBW side only. Dan keeps control of Bootlister and connects his server to this API. We do not need access to, change, or deploy his app.

## Connection

- Base URL: `https://www.westernbootworld.com/api/bootlister`
- Authentication: `Authorization: Bearer <WBW API key>`
- JSON requests: `Content-Type: application/json`
- Keep the key on Bootlister’s server. Never put it in browser JavaScript, a `NEXT_PUBLIC_` variable, a URL, source control, or a client-side storage value.
- Use the **www** hostname directly. The apex hostname redirects; credential-bearing clients should refuse redirects.

The key is dedicated to seller setup, connected seller status and inventory transfer. It is not a WBW login or a Supabase key. WBW checks Dan’s current admin permission and Terms acceptance on each request. Rotating/removing the receiver’s key hash or revoking his admin permission disables the connection.

## 1. Test the connection

`GET /api/bootlister` with the Authorization header returns:

```json
{
  "ok": true,
  "integration": "bootlister",
  "capabilities": ["sellers:provision", "sellers:status", "inventory:import", "inventory:publish"],
  "limits": { "itemsPerRequest": 1, "photosPerItem": 30 }
}
```

## 2. Create or connect the seller

Generate a UUID **once per seller**, save it in Bootlister, and reuse it across renames and future requests. The seller’s actual login email connects an existing WBW account; a new email creates an approved seller account.

`POST /api/bootlister`:

```json
{
  "action": "seller",
  "externalSellerId": "11111111-1111-4111-8111-111111111111",
  "seller": {
    "email": "seller@example.com",
    "displayName": "Seller’s shop name",
    "location": "Austin, TX",
    "authorized": true
  }
}
```

`authorized` records the operator’s confirmation that the seller permitted account setup and inventory transfer. Existing profiles, login details and preferences are kept. An existing connection cannot be reassigned to a different email or member. No email is sent by account creation, and WBW never invents email confirmation, phone verification or the seller’s Terms acceptance. The seller can later use normal WBW sign-in/password recovery to manage their account.

The response contains `ok`, `seller` (WBW profile ID/name/username/location/approval), and `wbwStatus` (`signed_up`, `accepted`, `phone_verified`, `source`, `checked_at`). Actual phone status remains honest even when Dan publishes on the seller’s behalf.

## 3. Upload current inventory

Bootlister fetches the seller’s current selling profile using its own existing tools. Send one listing per request; loop over current inventory on Bootlister’s server. Use a persistent Bootlister item ID, not the title, display name, a changing marketplace URL, or the row’s position in an export.

```json
{
  "action": "import",
  "externalSellerId": "11111111-1111-4111-8111-111111111111",
  "externalItemId": "00042",
  "publish": false,
  "listing": {
    "title": "Lucchese full quill ostrich boots",
    "price": "$250",
    "brand": "Lucchese",
    "size": "10",
    "size_type": "Men’s",
    "width": "D",
    "condition": "Broken In",
    "description": "The seller’s listing description.",
    "skin": "Ostrich",
    "material_type": "Exotic",
    "source_url": "https://seller.example.com/listings/42",
    "photo_urls": ["https://photos.example.com/boots-42.jpg"],
    "photo_alts": ["Brown full quill ostrich western boots"]
  }
}
```

WBW chooses the owner from the trusted seller connection. A supplied `user_id`, seller identity, sale status or buyer identity cannot change ownership. It copies all photos through its guarded importer into the seller’s storage folder. Supply 1–30 publicly reachable HTTPS photos; expired, inaccessible or partial photos fail the pair without saving partial inventory. Bootlister’s originals are not changed. Photo alt text is optional, in photo order. Direct video transfer is not part of this endpoint.

Other supported fields: `color`, `where_made`, `skin_family`, `toe_shape`, `heel_type`, `sole_type`, `outsole` (sole length), `sole_width`, `heel_height`, `shaft_height`, `shaft_circumference`, `keywords` (array), `size_estimated` (boolean), `custom_made` (boolean), `item_type` (`boots` or `belt`), and `buckle` (`included` or `not_included`). Put source details with no matching WBW field, such as model/date codes or a material-cut note, in the description. Title limit: 120 characters; description limit: 5,000 characters.

The response includes `ok`, `duplicate`, `listingId`, `sellerId`, `status`, `publication` and the canonical listing `url`. A draft is saved to that seller’s inventory but is not public.

## 4. List for sale on the seller’s behalf

Set `publish: true`, and include `listing.shipping_type` (`conus`, `usa`, `global` or `pickup`) plus the actual `listing.shipping_cost`. Dan’s admin authority lets him load managed stock without making the seller sign in or verify a phone first. It does not set a verified-seller badge or record consent on their behalf. Ordinary seller self-publication keeps its existing gates.

Required listing fields, at least one photo, media moderation and restricted-skin attestation still apply. **HTTP 200 and `ok: true` mean the import is confirmed, not necessarily that publication succeeded.** Check `status === "published"` or `publication.ok`. A rejected public listing stays a draft and `publication.error` explains what to fix. Sending a previously imported draft live reuses its existing pair ID.

## 5. Read seller status

`GET /api/bootlister?externalSellerId=<saved seller UUID>` returns the connected profile and current WBW signup, approval and phone status. Treat `checked_at` as the confirmation time; these are not continuously pushed updates.

## Retries and conflicts

- Retrying an unchanged item, including after a lost HTTP response, returns its existing WBW listing. Concurrent requests cannot insert it twice.
- The content fingerprint includes normalized listing fields and the ordered photo manifest. Changed content returns **409** for review. This initial-transfer API never overwrites an existing member’s listing automatically.
- Existing inventory with the same seller/source URL is held for reconciliation rather than duplicated. Reconcile earlier CSV/manual imports before sending the same stock through the API.
- Other errors: **400** invalid input, **401** invalid key, **403** revoked permission or approval, **404** unknown seller status, **422** unusable photos, **429** rate limit, **503** an unavailable or unconfirmed service. Retry an unconfirmed import with the same seller and item IDs.
- This endpoint does not schedule imports, infer sales from missing stock, synchronize sold states, delete inventory or implement bidirectional changes. Deleting a WBW pair removes its source key; reconcile intentional deletions before explicitly resending that stock.

## WBW operator setup

Apply `supabase/migrations/20261123181904_bootlister_connection.sql`. It adds a service-only seller mapping and protected, unique import metadata; it does not migrate inventory. Deploy the receiver, set `BOOTLISTER_API_KEY_SHA256` and `BOOTLISTER_ADMIN_USER_ID` on WBW’s server, and redeploy. Do not send the Supabase service-role key to Dan.

`node scripts/create-bootlister-key.mjs --admin-user <Dan’s WBW UUID> --out <private file>` generates a 256-bit key and its matching hash in a new owner-only file, without printing the credential or overwriting an existing file. Give Dan only the `bootlister.WBW_API_KEY` value through a private channel. WBW keeps the `wbw` section. The key is inactive until its matching hash is configured and the endpoint deployed. Use separate credentials for nonproduction tests.

Verify the authenticated health request after deployment, then let Dan connect one authorized seller and one listing before sending full inventory. The health request creates no seller or listing.
