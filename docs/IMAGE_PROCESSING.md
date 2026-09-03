# Wardrobe image processing

The wardrobe image pipeline is a backend service shared by MCP and the app.
MCP does not remove backgrounds and the client must not run a second cutout
algorithm.

```text
original upload
  -> category-aware segmentation / matting
  -> mask refinement
  -> disconnected-region and halo validation
  -> new 1024x1024 card canvas
  -> #F8F7F5 background + low-opacity soft shadow
  -> processed upload
```

`wardrobe_card` is used for ordinary clothes, shoes and accessories.
`eyewear_card` is selected automatically when the category/name/subcategory
contains `glasses`, `sunglasses`, `eyeglasses`, `eyewear` or
`optical_glasses`. The eyewear preset is expected to preserve thin temples,
metal frames, bridges, gaps and transparent/semitransparent lenses. The
processor must return a cutout, not a redrawn or generated product image.

## Storage contract

New rows have two independent artifacts:

- `original_image_path`: the exact user upload, never overwritten;
- `processed_image_path`: the square display card;
- `image_path`: the backwards-compatible display alias. It points to the
  processed card when `image_status=attached`, otherwise to the original
  fallback.

The synchronous backend flow writes `image_status=processing`, uploads the
original, calls the processor, validates the result, uploads the processed
card, then links both paths and returns `attached`. A low-confidence or
artifact-heavy result is not uploaded: the original remains visible and the
row is returned as `needs_review`. Provider/Storage failures use `failed` or a
safe original fallback. `attached` is never returned before the processed
object is uploaded and linked.

Legacy rows with only `image_path` continue to render. The additive migration
maps old MCP-pending rows to `original_image_path` + `needs_review` and ordinary
legacy rows to `processed_image_path` + `attached`.

## Processor HTTP contract

Set `METTI_IMAGE_PROCESSOR_URL` and keep the optional
`METTI_IMAGE_PROCESSOR_API_KEY` server-side. The backend sends a multipart
request with `image_file`, `preset`, `category`, `subcategory`,
`target_width=1024`, `target_height=1024`, `background_color=#F8F7F5`,
`padding=0.12`, `shadow=soft`, `preserve_original_pixels=true` and
`return_quality=true`.

The response is JSON:

```json
{
  "provider": "metti-matting-1",
  "image_base64": "<transparent PNG cutout>",
  "mime_type": "image/png",
  "quality": {
    "width": 1600,
    "height": 1200,
    "segmentation_confidence": 0.93,
    "foreground_ratio": 0.21,
    "foreground_width_ratio": 0.74,
    "foreground_height_ratio": 0.40,
    "disconnected_regions": 4,
    "halo_ratio": 0.02,
    "edge_truncation_ratio": 0,
    "retained_background_ratio": 0.01,
    "source_similarity": 0.38,
    "fine_detail_recall": 0.91,
    "transparent_region_preserved": 0.96
  }
}
```

The backend accepts the equivalent `x-metti-*` headers for a binary PNG
response. Missing quality evidence is rejected safely. The service wraps the
validated untouched PNG in an SVG image artifact so the square canvas,
background, scale, centering and subtle shadow are deterministic and shared.

For the deployed Metti project, the Edge Functions use the Cloudflare Worker
`metti-image-processor` as the default endpoint when no override is supplied.
It applies Cloudflare Images `segment=foreground` (BiRefNet) to the raw
request bytes and returns the same binary-PNG plus `x-metti-*` quality
contract. The Worker validates the forwarded Supabase JWT against Auth and
does not persist uploads. A configured `METTI_IMAGE_PROCESSOR_URL` still
takes precedence, so the category-aware `grounding_dino_sam2` service below can
replace it for higher-control eyewear segmentation.

The external endpoint can be a private service running a detector + SAM/SAM2
or another category-aware segmentation model followed by matting. This is the
recommended production setup for cluttered eyewear photos because the
category is passed to the model and the service can return confidence and
fine-detail diagnostics. A local/self-hosted deployment has no per-image API
credit charge, but it needs GPU/CPU hosting and model operations.

This repository now includes a runnable reference implementation in
`services/image-processor/`. Its `grounding_dino_sam2` backend uses a
Grounding DINO category detector, prompted SAM/SAM2 and optional rembg alpha
matting. The detector and SAM weights are deliberately mounted/configured
separately. Start with `services/image-processor/.env.example`, keep the
service on a private network, and set the same `METTI_PROCESSOR_API_KEY` value
in the container and the Supabase Edge Function secret. The service has no
persistence and exposes only `GET /healthz` and `POST /process`.

When the Supabase project is hosted, `METTI_IMAGE_PROCESSOR_URL` must be an
HTTPS endpoint reachable from the Edge Function runtime. “Private” means it is
not anonymously public: put it behind private networking where the hosting
setup supports it, or use an authenticated HTTPS ingress. `localhost` or a
developer LAN address cannot be used by a hosted Edge Function.

The Cloudflare adapter lives in `cloudflare/image-processor/` and is already
deployed at
`https://metti-image-processor.road-guide-natasha7261.workers.dev`. Its Images
binding is billed per unique transformation, so the Worker deliberately uses
`Cache-Control: no-store` for private wardrobe photos; check the account's
Images plan before enabling large imports. The adapter is a generic
foreground segmenter rather than a prompted detector, so eyewear results
still pass through the stricter transparent-region quality gate.

For a quick commercial prototype, a background-removal API can be placed
behind this contract. remove.bg documents transparent PNG output, alpha matte
output, ROI/crop controls and soft-shadow parameters in its [API
documentation](https://www.remove.bg/bg/api); its published pricing currently
includes the first 50 API calls per month and then credit-based plans in the
[pricing page](https://www.remove.bg/pricing/). It should be treated as a
provider experiment rather than a hard dependency: a generic remover may
select a nearby case or cup along with glasses, so the eyewear preset and
quality gate must still reject unsafe masks. The provider also documents a
planned API migration on 1 December 2026, which is another reason the adapter
is URL/config driven.

## Tests

The shared service is injected with a fake processor in tests. The fixtures
cover black sunglasses, thin metal frames, transparent and tinted lenses,
light/dark backgrounds, a nearby case, a cluttered table, very thin temples
and a deliberately low-quality mask that must fall back to the original.
