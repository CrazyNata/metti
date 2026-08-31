# Metti MCP Server

Metti now exposes a remote MCP server from the same Supabase project and the same repository. The MCP function is an additional interface to the existing user data; it is not a second wardrobe database and it does not call an LLM.

## Architecture

The current repository is a regular repository rather than a package-managed monorepo: the client is a static WebView/mobile app, and the server-side pieces are Supabase SQL and Deno Edge Functions. It is backed by Supabase PostgREST, Supabase Auth, private Storage and the existing `metti-stylist` Edge Function. The MCP entrypoint is:

```text
supabase/functions/metti-mcp/index.ts
```

The shared application layer is in `supabase/functions/_shared/`:

- `auth.ts` validates the existing Supabase bearer token with `/auth/v1/user`;
- `supabase-client.ts` calls PostgREST and private Storage using that same user token;
- `wardrobe-service.ts`, `profile-service.ts` and `outfit-service.ts` contain the reusable domain operations;
- `services.ts` creates the per-user service bundle;
- `serializers.ts`, `validation.ts`, `types.ts` and `errors.ts` keep validation and response shapes consistent.

The MCP tools call these services directly. The existing `metti-stylist` function now uses the same auth/data/service layer for its wardrobe and profile context. The web/mobile client continues to use the same Supabase tables, RLS policies and Storage bucket.

```text
Web/Mobile -> Supabase PostgREST/Auth/Storage
                         ▲
                         │ shared services + RLS
                         │
ChatGPT/MCP client -> metti-mcp (Streamable HTTP)
```

## Endpoints

When deployed as a Supabase Edge Function, the native URL is:

```text
https://<project-ref>.supabase.co/functions/v1/metti-mcp
https://<project-ref>.supabase.co/functions/v1/metti-mcp/health
```

Put a reverse proxy in front if the public contract should be `/mcp` and `/health`:

```text
https://api.example.com/mcp
https://api.example.com/health
```

The currently deployed Cloudflare edge endpoint is:

```text
https://metti-mcp-edge.road-guide-natasha7261.workers.dev/mcp
https://metti-mcp-edge.road-guide-natasha7261.workers.dev/health
```

The existing static app is also deployed from `mobile/` as the Cloudflare Pages project
`metti-web`:

```text
https://metti-web.pages.dev/
https://metti-web.pages.dev/oauth-consent.html
```

The transport is the official MCP Streamable HTTP transport. The MCP server factory is stateless (a fresh tool server is created for each authenticated request), and the SDK uses the response mode requested by the client; clients should advertise both `application/json` and `text/event-stream`. Every HTTP request is authenticated before MCP dispatch.

## Authentication and isolation

Send the existing Supabase access token:

```http
Authorization: Bearer <supabase-access-token>
```

The server resolves the user from Supabase Auth. MCP tool arguments intentionally do not accept `user_id`. All reads and writes use the authenticated user token against PostgREST, so the existing RLS policies remain the final tenant-isolation boundary. An anonymous request returns `401`; an item or outfit from another user behaves as not found.

MCP does not implement a second user store or OAuth issuer. The repository now includes an optional OAuth 2.1 consent UI at `mobile/oauth-consent.html`; it uses the same Supabase Auth session and the same publishable client, and calls Supabase's OAuth authorization-server methods for consent. A client can therefore either attach an existing Supabase bearer token directly or use Supabase Auth OAuth 2.1 after the project feature is enabled. Do not put a service-role key in a client or tool argument.

For the static WebView-style app, configure the Supabase OAuth Server Authorization Path as `/oauth-consent.html` and use `https://metti-web.pages.dev` as the Site URL. The page reads the `authorization_id` query parameter, reuses the current Metti login/session, displays the client name, redirect URI and requested scopes, then redirects to Supabase's returned `redirect_url` after the user approves or denies. If the web host supports clean rewrites, the same page can be exposed as `/oauth/consent` instead.

## Tools

Read tools:

- `get_profile`
- `get_style_preferences`
- `list_wardrobe`
- `search_wardrobe`
- `get_wardrobe_item`
- `list_outfits`
- `get_outfit`
- `get_wear_history`

Write tools:

- `update_style_preferences`
- `add_wardrobe_item`
- `update_wardrobe_item`
- `archive_wardrobe_item`
- `save_outfit`
- `update_outfit`
- `archive_outfit`
- `favorite_outfit`
- `mark_as_worn`

Wardrobe and outfit lists default to 40 records and cap `limit` at 100. Filters and pagination are part of the tool schemas. `get_wardrobe_item` and `get_outfit` return short-lived signed Storage URLs when private images exist; image bytes/base64 are never returned.

The database keeps its existing category enum (`outer`, `top`, `bottom`, `shoes`, `accessory`). For MCP ergonomics, `jeans` and `bag` are accepted as category aliases and are stored/filtered as `bottom + subcategory=jeans` and `accessory + subcategory=bag`; no schema expansion is needed.

There is currently no wishlist table in the existing schema, so wishlist tools are intentionally not advertised. The existing model also stores optional fields such as subcategory, occasions, tags and favorite flags inside the current `metadata` JSONB rather than introducing a parallel MCP model.

`archive_wardrobe_item` and `archive_outfit` are soft deletes. The small additive migration `supabase/migrations/202608310002_metti_mcp_archive_columns.sql` adds nullable `archived_at` columns and indexes to the existing tables. No separate MCP database is created, and the already-applied `202608310001` migration is left unchanged.

### Tool schemas

All schemas are strict objects. IDs are non-empty safe identifiers; list tools use `page` (1-based, default `1`) and `limit` (default `40`, maximum `100`). Omitted optional fields mean “leave unchanged” for update tools.

- `get_profile`, `get_style_preferences`: `{}`.
- `update_style_preferences`: any of `styleTags`, `preferredColors`, `avoidedColors`, `preferredBrands`, `dislikedBrands`, `preferredFits`, `clothingSizes`, `shoeSize`, `height`, `gender`, `styleNotes`.
- `list_wardrobe`: `category` (`outer|top|bottom|shoes|accessory|jeans|bag`), `subcategory`, singular or plural `color(s)`, `brand(s)`, `season(s)`, `occasion(s)`, `favorite`, `status` (`active|archived|all`), `tags`, `page`, `limit`.
- `search_wardrobe`: `query`, `category`, `subcategory`, `colors`, `brands`, `seasons`, `occasion`/`occasions`, `favorite`, `status`, `tags`, `page`, `limit`.
- `get_wardrobe_item`, `archive_wardrobe_item`: `{ itemId }`.
- `add_wardrobe_item`: required `name`, `category`; optional `subcategory`, `brand`, `color`/`colors`, `size`, `season`, `material`, `pattern`, `fit`, `occasion`/`occasions`, `tags`, `notes`, `favorite`, `imagePath`. `jeans` and `bag` are accepted aliases as described above.
- `update_wardrobe_item`: `{ itemId }` plus any subset of the fields accepted by `add_wardrobe_item`.
- `list_outfits`: `favorite` (the legacy-compatible alias `favorites` is also accepted), `occasion`, `season`, `date` (`YYYY-MM-DD`), `tags`, `status`, `page`, `limit`.
- `get_outfit`, `archive_outfit`: `{ outfitId }`.
- `save_outfit`: required `itemIds`; optional `name`, `occasion`, `season`, `notes`, `tags`, `favorite`, `prompt`, `temperatureC`, `weatherCode`.
- `update_outfit`: `{ outfitId }` plus any subset of `name`, `itemIds`, `occasion`, `season`, `notes`, `tags`, `favorite`, `prompt`.
- `favorite_outfit`: `{ outfitId, favorite }`.
- `get_wear_history`: optional `{ page, limit }`.
- `mark_as_worn`: `{ outfitId }` or `{ itemIds }`, with optional ISO `wornAt`.

Every successful tool returns MCP `structuredContent` plus a compact JSON text representation. Domain failures use `{ error: { code, message } }`; schema failures are reported as standard MCP tool input-validation errors without stack traces.

### Example tool calls

After `initialize`, the following JSON-RPC bodies can be sent to the same endpoint with the authenticated bearer token:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_wardrobe","arguments":{"category":"jeans","colors":["black"],"limit":20}}}
```

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"save_outfit","arguments":{"name":"Dinner layers","itemIds":["<owned-item-id-1>","<owned-item-id-2>"],"occasion":"dinner","tags":["evening"]}}}
```

The MCP server does not choose the outfit or generate fashion advice. ChatGPT or a future Stylist Skill performs that reasoning, then uses `save_outfit` only after the user asks to save the result.

## Optional Cloudflare edge deployment

The repository also contains a Cloudflare Worker edge layer at:

```text
cloudflare/mcp-edge/
```

It is intentionally a thin proxy, not a second MCP implementation. The Worker exposes the public `/mcp` and `/health` paths, applies edge host/origin checks, preserves the authenticated bearer token and MCP headers, and forwards requests to the existing Supabase MCP function:

```text
ChatGPT/MCP client
        |
        v
Cloudflare Worker: /mcp
        |
        v
Supabase Edge Function: /functions/v1/metti-mcp
        |
        v
shared services -> Supabase Auth/PostgREST/Storage
```

The Worker stores no user data, does not log or replace access tokens, has no database binding and registers no tools. This keeps one source of truth for authentication, tools, validation and business logic. The current deployment is `https://metti-mcp-edge.road-guide-natasha7261.workers.dev/mcp`. The static consent UI is deployed separately from the same repository as Cloudflare Pages `metti-web`.

Local Cloudflare development requires Node.js/npm and Wrangler:

```powershell
Set-Location cloudflare/mcp-edge
Copy-Item .dev.vars.example .dev.vars
npm install
npm run dev
```

The Worker is then available at `http://localhost:8787/mcp`. Run its checks with:

```powershell
npm run check
npm run typecheck
npm run test
npm run build
```

`build` is a Wrangler dry-run. Before deployment, set the exact production values for `METTI_MCP_UPSTREAM_URL`, `MCP_ALLOWED_ORIGINS` and `MCP_ALLOWED_HOSTS` in `wrangler.jsonc` or the Cloudflare environment, then run:

```powershell
npx wrangler@latest login
npx wrangler@latest types
npx wrangler@latest check
npx wrangler@latest deploy
```

Cloudflare does not replace Supabase Auth or RLS. The upstream migration and Supabase function must be deployed first. If a client requires OAuth, enable Supabase Auth OAuth 2.1, configure the authorization path to the deployed `oauth-consent.html` page, and use the Supabase discovery endpoint. The Worker itself remains a thin proxy and forwards the Supabase-issued bearer contract; it does not store OAuth secrets or refresh tokens.

References: [Cloudflare remote MCP deployment](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/), [Workers fetch handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## Local development

Prerequisites: Supabase CLI and Deno. From the repository root, start the local Supabase stack if needed and apply the schema:

```powershell
supabase start
supabase db reset
```

Set the local function environment in `.env.local` (this file is ignored by Git):

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local-anon-key>
MCP_ALLOWED_HOSTS=localhost,127.0.0.1
MCP_RATE_LIMIT_PER_MINUTE=120
```

Run the MCP function independently of the WebView:

```powershell
supabase functions serve metti-mcp --no-verify-jwt --env-file .env.local
```

The function is then available at `http://127.0.0.1:54321/functions/v1/metti-mcp`. A health check does not require a token:

```powershell
Invoke-WebRequest http://127.0.0.1:54321/functions/v1/metti-mcp/health
```

The same command is available as a Deno task from the MCP module directory:

```powershell
Set-Location supabase/functions/metti-mcp
deno task dev
# or: deno task start
```

For a quick authenticated protocol smoke test, use a real access token from the existing app session:

```powershell
$headers = @{
  Authorization = "Bearer $env:METTI_ACCESS_TOKEN"
  Accept = "application/json, text/event-stream"
  "Content-Type" = "application/json"
}
$body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"metti-smoke-test","version":"1.0.0"}}}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:54321/functions/v1/metti-mcp -Headers $headers -Body $body
```

To inspect the advertised tools, send the `tools/list` body shown above. With the standard `Accept` header the response may be framed as one `text/event-stream` message; the `data:` line contains the JSON-RPC result. An MCP Inspector can also be pointed at the same URL with the bearer token when using an inspector version that supports Streamable HTTP.

## Tests and checks

From `supabase/functions/metti-mcp`:

```powershell
deno task check
deno task test
deno task build
```

`build` is the Deno bundle/type validation used by this Edge Function; the Supabase CLI performs the deploy bundle step. The tests cover anonymous and invalid-token rejection, authenticated dispatch, RLS-style not-found behavior for another user’s item/outfit, filter/pagination, wardrobe and outfit writes, archive behavior, wear history, strict schemas, structured reads/writes and `tools/list` registration. There were no existing automated test commands in the repository to run; the existing frontend assets were preserved.

## Production deployment

The function can be deployed independently while remaining in this repository:

```powershell
supabase link --project-ref <project-ref>
supabase db push
supabase secrets set MCP_ALLOWED_ORIGINS=https://chatgpt.com MCP_ALLOWED_HOSTS=api.example.com MCP_RATE_LIMIT_PER_MINUTE=120
supabase functions deploy metti-mcp --no-verify-jwt
```

`verify_jwt` is disabled only at the Supabase gateway because `metti-mcp` performs the same bearer-token validation explicitly and then uses the token for RLS. The web app and `metti-stylist` function are not changed to use this setting.

Before giving the endpoint to a client, place it behind HTTPS, configure the exact allowed origin/host values, apply the migration, and decide how the MCP client will obtain/attach Supabase access tokens. No OpenAI/Gemini call is made by this MCP module.

### OAuth 2.1 completion checklist

The code-side consent screen is present, but the Supabase project feature is an explicit project-level setting and is not enabled by the repository migration. Complete this once in the Supabase Dashboard:

1. Open Authentication -> OAuth Server and enable OAuth 2.1 server capabilities.
2. Set the Authorization Path to `/oauth-consent.html` (or `/oauth/consent` if the deployed static host rewrites that path to the page).
3. Set the Site URL to `https://metti-web.pages.dev` in Authentication -> URL Configuration.
4. Register the MCP client, or enable dynamic client registration only if the client is trusted and its exact redirect URI policy is acceptable.
5. Verify the discovery URL:

```text
https://fkicjvawvaddjdmcpiei.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

The project currently returns `404` from this discovery URL until the OAuth Server capability is enabled. Supabase OAuth authorization-code flow uses PKCE and issues Supabase tokens that continue to work with the existing RLS policies; see the [Supabase OAuth 2.1 guide](https://supabase.com/docs/guides/auth/oauth-server/getting-started) and [MCP authentication guide](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication).
