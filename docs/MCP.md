# Metti MCP Server

Metti MCP is an additional data-and-actions interface for the existing Online
Stylist application. It lives in this repository and uses the existing Supabase
Auth, PostgREST tables, RLS policies and private `wardrobe` Storage bucket. It
does not create a second database, a second wardrobe, a second image store or a
second business-logic layer, and it never calls an LLM.

## Repository architecture

This repository is a static WebView/mobile application backed directly by
Supabase, plus Supabase Edge Functions. The relevant paths are:

- `supabase/functions/metti-mcp/index.ts` — MCP runtime entrypoint.
- `supabase/functions/metti-mcp/server.ts` — authenticated Streamable HTTP
  handler and tool registration.
- `supabase/functions/_shared/` — auth, validation, serializers, data client,
  `WardrobeService`, `ImageService`, `ProfileService` and `OutfitService`.
- `supabase/functions/metti-stylist/` — the existing stylist function using
  the same shared services for its data context.
- `cloudflare/mcp-edge/` — optional thin Cloudflare Worker proxy. It stores no
  user data and does not register MCP tools.
- `mobile/supabase-client.js` and
  `android/app/src/main/assets/supabase-client.js` — the existing app upload
  and signed-URL flow, kept intact.

The request paths are:

```text
Existing app -> Supabase Auth/PostgREST/Storage -> existing tables and bucket

ChatGPT/MCP client -> optional Cloudflare proxy -> metti-mcp
                    -> shared services -> same Auth/PostgREST/Storage
```

The mobile app currently uses the Supabase REST/Storage contract directly;
server-side features use the shared TypeScript services. Both paths remain
tenant-isolated by the same database schema, Storage policies and user folder
convention.

## Endpoints

Direct Supabase Edge Function:

```text
https://<project-ref>.supabase.co/functions/v1/metti-mcp
https://<project-ref>.supabase.co/functions/v1/metti-mcp/health
```

The MCP endpoint accepts standard Streamable HTTP requests at the function URL.
The health endpoint is unauthenticated and returns `200` only when the
Supabase configuration is present.

Optional Cloudflare edge endpoint:

```text
https://<worker-host>/mcp
https://<worker-host>/health
https://<worker-host>/.well-known/oauth-protected-resource
```

The Worker forwards the bearer token and MCP protocol headers to the Supabase
origin. It is only a routing and edge-policy layer; the origin remains the
source of truth for authentication, tools, validation and RLS.

## Authentication and isolation

Every MCP request except CORS preflight and `/health` must contain:

```http
Authorization: Bearer <Supabase access token>
```

`authenticateRequest` validates the token with Supabase Auth and derives the
user id from the returned session. No tool accepts `userId` or `user_id` as an
ownership source. The same access token is used for PostgREST and Storage, so
existing RLS policies remain the final authorization boundary.

Unauthenticated and invalid-token requests return `401`. An object belonging to
another user is intentionally reported as not found, including for item,
outfit and image operations. The Supabase gateway setting `verify_jwt=false`
is used only because the function performs explicit bearer validation and needs
the same token for RLS; it is not a bypass.

## Tools

The server advertises 20 tools. The V1 data contract is:

### Profile

- `get_profile`
- `get_style_preferences`
- `update_style_preferences`

### Wardrobe

- `list_wardrobe`
- `search_wardrobe`
- `get_wardrobe_item`
- `create_wardrobe_item`
- `update_wardrobe_item`
- `archive_wardrobe_item`

### Images

- `attach_image_to_wardrobe_item`
- `replace_wardrobe_item_image`
- `remove_wardrobe_item_image`

### Outfits

- `list_outfits`
- `get_outfit`
- `save_outfit`
- `update_outfit`
- `archive_outfit`

The repository also keeps the existing outfit convenience tools
`favorite_outfit`, `get_wear_history` and `mark_as_worn` available through
MCP.

All list/search tools use pagination: default `limit=40`, maximum `limit=100`.
Successful tools return MCP `structuredContent` plus compact JSON text. Domain
errors return a safe public `{ error: { code, message } }` payload; schema
failures are standard MCP input-validation errors without stack traces.

### create_wardrobe_item

`name` and `category` are required. The remaining metadata is optional so the
client can omit characteristics that cannot be inferred reliably:

```json
{
  "name": "Beige trench coat",
  "category": "outerwear",
  "subcategory": "trench",
  "colors": ["beige"],
  "pattern": "solid",
  "fit": "regular",
  "length": "long",
  "seasons": ["spring", "autumn"],
  "styles": ["classic", "minimal"],
  "tags": ["trench", "beige"]
}
```

The public category schema includes the existing database categories
`outer`, `top`, `bottom`, `shoes`, `accessory` plus ergonomic aliases
`outerwear`, `jeans` and `bag`. The backend maps aliases to existing
values; no new enum or MCP-only filter field is introduced.

`update_wardrobe_item` accepts a partial editable set of the same metadata.
`archive_wardrobe_item` is a soft archive. All automatically supplied values
remain ordinary editable wardrobe fields in the existing app.

## Image flow

### Existing app upload

The app flow is unchanged:

```text
App Add Item -> select/take photo -> upload to private wardrobe bucket
             -> create/update wardrobe row -> manual metadata editing
```

The existing client still uploads JPEG/PNG/WebP/HEIC/HEIF files to the private
`wardrobe` bucket, signs URLs for display, replaces images and removes images.
MCP does not replace this flow and no AI is required for it.

### ChatGPT recognition and MCP persistence

ChatGPT is responsible for seeing the user’s photograph, recognizing the item,
choosing reliable characteristics and deciding when to call MCP. MCP only
validates and persists the supplied structured fields; it does not perform
image recognition, fashion reasoning or call OpenAI/Gemini/another LLM.

When the MCP host can provide the original image, `create_wardrobe_item` or an
image tool accepts the standard MCP resource vocabulary:

```json
{ "type": "image", "data": "<base64>", "mimeType": "image/jpeg" }
```

```json
{
  "type": "resource_link",
  "uri": "https://trusted.example/item.jpg",
  "mimeType": "image/jpeg"
}
```

```json
{
  "type": "resource",
  "resource": {
    "uri": "mcp://attachment/item-1",
    "blob": "<base64>",
    "mimeType": "image/jpeg"
  }
}
```

The server decodes/streams the supported representation, validates it and
uploads it through `ImageService` to the same private `wardrobe` bucket. It
then stores the user-scoped `image_path` on the wardrobe row. It never stores
base64 in the database and never returns image bytes; read responses contain a
short-lived signed `imageUrl` where available.

When an image was added through MCP, the shared wardrobe service marks it with
an internal `image_source=mcp` and `image_background=pending` metadata value.
On the next authenticated app sync, the existing browser image flow downloads
that image, removes a connected plain-color border when possible, composites it
onto the warm cream editorial background used by the mockup, uploads the
formatted JPEG to the same private bucket and removes the old object only
after the new database link succeeds. This is deterministic client-side image
processing; MCP still does not call an LLM or an image-generation API. If the
browser cannot process the format or the Storage request fails, the original
MCP image remains available and can be retried on the next sync.

The accepted inline image formats are JPEG, PNG, WebP, HEIC and HEIF, with a
default maximum of 5 MiB. A remote `resource_link` is fetched only when its
HTTPS hostname is explicitly in `MCP_ALLOWED_IMAGE_HOSTS`.

### Fallback when the original attachment is unavailable

An MCP host is not assumed to expose raw attachment bytes. If a resource is a
reference that cannot be safely fetched, or a remote fetch times out/fails, the
metadata item is still created and the action response contains:

```json
{
  "imageAttached": false,
  "imageStatus": "pending"
}
```

Without an image argument the response uses `imageStatus: "none"`. The user can
then add the photo through the existing app upload flow. A successful upload
returns `imageAttached: true` and `imageStatus: "attached"`.

If an image upload succeeds but linking it to a new row fails, the service
attempts compensating Storage deletion and leaves a valid item without an
image. Replacing an existing path uses Storage upsert so a link remains valid;
removal clears the link and deletes the object, rolling back the link if the
delete fails.

The image tools use the same ownership checks as wardrobe tools:

- `attach_image_to_wardrobe_item` requires an item without a current image.
- `replace_wardrobe_item_image` replaces the current image.
- `remove_wardrobe_item_image` deletes only the authenticated user’s linked
  image and keeps the item.

The MCP SDK’s image/resource content vocabulary is documented in the
[official TypeScript SDK server documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
and the [official tools specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/server/tools.mdx).

## Storage and security

The existing private bucket is `wardrobe`. MCP paths are generated below the
authenticated user folder, for example:

```text
<authenticated-user-id>/<item-id>-<random-id>.jpg
```

The service validates user-folder paths and item-id segments. It does not make
private images public; display URLs are short-lived signed Storage URLs.

Image/resource protections include:

- supported MIME allowlist and a 5 MiB byte limit;
- base64 length limit before decoding;
- basic file-signature/MIME consistency checks;
- 10-second fetch timeout covering response-body streaming;
- bounded remote download, including chunked responses;
- HTTPS by default, with `MCP_ALLOW_HTTP_IMAGE_RESOURCES=false` by default;
- exact or explicit wildcard host allowlist for remote resources;
- rejection of credentials in URLs, `file://`, localhost, loopback, private,
  link-local, multicast and reserved IP ranges;
- redirects disabled for remote image downloads;
- 8 MiB default MCP request-body cap, configurable with
  `MCP_MAX_BODY_BYTES`;
- rate limiting and optional origin/host allowlists.

The host allowlist is deliberately separate from `MCP_ALLOWED_HOSTS`: the
former controls server-side image downloads and the latter controls inbound
MCP host headers. Keep both narrow in production.

## Normalization and filters

The MCP input is mapped to the current wardrobe model. Existing database
columns remain the source of truth; flexible attributes continue to use the
existing `metadata` JSONB column. The normalization layer canonicalizes common
variants, for example:

```text
чёрный / jet black -> black
dark blue          -> blue
navy               -> navy
осень / fall       -> autumn
trench coat        -> trench
shoulder bag       -> shoulder_bag
multi-word styles  -> lower-case hyphenated tokens
```

`color`/`colors`, `season`/`seasons`, `subcategory`, `length`,
`styles`, `occasions` and `tags` are written to the same row
fields/metadata used by the existing wardrobe filters. There are no
`aiCategory`, `aiColor` or `aiStyle` columns. The app can edit every
stored value later.

## Environment

Copy `.env.example` to a local, untracked env file and fill in only the
project’s publishable Supabase values:

```dotenv
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-or-anon-key>
MCP_ALLOWED_ORIGINS=
MCP_ALLOWED_HOSTS=
MCP_RATE_LIMIT_PER_MINUTE=120
MCP_MAX_BODY_BYTES=8388608
MCP_ALLOWED_IMAGE_HOSTS=
MCP_IMAGE_MAX_BYTES=5242880
MCP_IMAGE_FETCH_TIMEOUT_MS=10000
MCP_ALLOW_HTTP_IMAGE_RESOURCES=false
```

Do not put a `service_role` key in a client, MCP tool argument or committed
file. `MCP_ALLOWED_IMAGE_HOSTS` may remain empty when only inline/resource-blob
images should be accepted; unconfigured remote links then produce the safe
`pending` fallback.

## Local development

The MCP module is a separate runtime inside this repository, not a second
repository:

```powershell
supabase start
supabase functions serve metti-mcp --no-verify-jwt --env-file .env.local
```

The local endpoints are:

```text
http://127.0.0.1:54321/functions/v1/metti-mcp
http://127.0.0.1:54321/functions/v1/metti-mcp/health
```

The function’s Deno tasks are available from
`supabase/functions/metti-mcp`:

```powershell
deno task dev
deno task start
deno task check
deno task test
```

The direct MCP URL can be used by an MCP Inspector or another Streamable HTTP
client. Send both `application/json` and `text/event-stream` in `Accept`
for client compatibility.

The optional Cloudflare proxy is developed independently but remains in this
repository:

```powershell
Set-Location cloudflare/mcp-edge
pnpm install
pnpm run types
pnpm run check
pnpm run typecheck
pnpm run build
```

`pnpm run build` is a Wrangler dry-run. Local proxy values belong in the
untracked `.dev.vars`; production values/secrets belong in the Cloudflare
environment. The proxy uses generated `worker-configuration.d.ts` types.

## Tests and deployment

The Supabase MCP tests cover:

- anonymous, authenticated and invalid-token requests;
- strict tool discovery and required schemas;
- structured tool responses and safe errors;
- user isolation for items, outfits and image operations;
- wardrobe list/search/pagination, update/archive and normalization;
- inline and resource image attachment;
- invalid/oversized/unsupported images;
- failed image link/upload compensation and orphan prevention;
- allowlisted remote resources and pending fallback;
- outfit create/get/update/archive behavior.

Apply the existing database migrations before deploying an environment:

```powershell
supabase db push
supabase functions deploy metti-mcp --no-verify-jwt
```

No separate MCP migration or database is required. The archive migration is
additive and applies to the existing `wardrobe_items` and `saved_outfits`
tables; image metadata uses the existing `image_path` and `metadata` fields.

For the optional edge proxy, set the upstream URL, auth-server URL, exact
allowed host/origins and request cap in `cloudflare/mcp-edge/wrangler.jsonc` or
the Cloudflare environment, then run:

```powershell
Set-Location cloudflare/mcp-edge
pnpm run deploy
```

The Worker follows Cloudflare’s stateless Streamable HTTP pattern; see the
[Cloudflare remote MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/).

## Connecting a ChatGPT/MCP client

Provide the direct Supabase function URL or the optional Worker `/mcp` URL to
a client that supports remote Streamable HTTP and can attach the authenticated
Supabase bearer token (or a configured Supabase OAuth flow). The client should
call `get_profile`/`get_style_preferences` when context is needed, use
`search_wardrobe` before proposing items the user may already own, and call
`save_outfit` only after the user asks to save an outfit.

For an image request, ChatGPT performs recognition and calls
`create_wardrobe_item` with only reliable fields. If the client can forward an
official MCP image/resource representation, MCP stores it in the existing
bucket. Otherwise the item is still created and the user finishes the photo
upload in the normal app. This supports both required flows:

```text
photo -> existing app -> existing private Storage -> editable wardrobe item

photo -> ChatGPT recognition -> MCP metadata/image persistence
      -> same Storage + same database -> visible in existing app
```
