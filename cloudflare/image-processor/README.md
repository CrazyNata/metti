# Metti Cloudflare image processor

This Worker is the hosted adapter for the shared Supabase wardrobe image
contract. It accepts the original upload in memory, uses Cloudflare Images'
`segment=foreground` transformation (BiRefNet), analyzes the returned PNG
alpha channel, and returns a transparent PNG with the quality headers expected
by `ImageService`.

The Worker never stores the upload. It authenticates the bearer token against
the Metti Supabase Auth endpoint. A static `METTI_PROCESSOR_API_KEY` secret is
also supported for private service-to-service calls, but is not required for
the deployed Metti path because the Edge Functions forward the authenticated
user JWT.

## Deploy

The Worker is already deployed for the Metti project at:

```text
https://metti-image-processor.road-guide-natasha7261.workers.dev
```

For a repeatable local deployment, install Wrangler and run:

```powershell
npx wrangler deploy --config wrangler.jsonc
```

The Images binding is billed per unique transformation. The Worker returns
`Cache-Control: no-store` because wardrobe photos are private; review the
account's Images pricing before enabling high-volume imports.

## Contract smoke test

```powershell
curl.exe -X POST https://metti-image-processor.road-guide-natasha7261.workers.dev/process `
  -H "Authorization: Bearer <valid-metti-user-jwt>" `
  -F "image_file=@C:\photos\item.jpg" `
  -F "preset=eyewear_card" `
  -F "category=accessory" `
  -F "subcategory=glasses" `
  -F "name=black sunglasses" `
  -F "target_width=1024" `
  -F "target_height=1024" `
  -F "background_color=#F8F7F5" `
  -F "padding=0.12" `
  -F "shadow=soft" `
  -F "preserve_original_pixels=true" `
  -F "return_quality=true"
```

`GET /healthz` is a non-sensitive liveness check. `POST /process` is the only
image route.
