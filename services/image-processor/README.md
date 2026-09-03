# Metti private image processor

This service implements the `METTI_IMAGE_PROCESSOR_URL` contract used by the
shared Supabase `ImageService`. It receives an image in memory and returns a
transparent PNG cutout plus quality metrics. It does not store uploads and it
does not generate or redraw the product. The Supabase service creates the
1024×1024 `#F8F7F5` card and soft shadow after validation.

## Production backend

Use `grounded_sam2` for wardrobe photos:

1. YOLO-World/YOLOE detects an object using the wardrobe category prompt;
2. SAM or SAM2 segments the selected detection box;
3. rembg alpha matting supplies soft edges and semi-transparent pixels;
4. the pipeline clips the matte to the selected ROI, keeps thin eyewear
   components, and emits diagnostics for the Supabase quality gate.

Model weights are intentionally not committed. Place approved weights in a
private volume and set `METTI_DETECTOR_MODEL` and `METTI_SAM_MODEL`. The
detector must support `set_classes()` (YOLO-World/YOLOE), otherwise the service
returns `processor_not_ready` rather than silently using a generic detector.

The `rembg` backend is an explicit prototype option. It has no category-aware
detector and intentionally reports conservative eyewear confidence/detail
metrics, so it must not be treated as the production glasses solution.

## Run locally

From this directory, install the pinned dependencies and provide model files:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
$env:METTI_PROCESSOR_API_KEY = "local-only-secret"
$env:METTI_PROCESSOR_BACKEND = "grounded_sam2"
$env:METTI_DETECTOR_MODEL = "C:\models\yolov8s-worldv2.pt"
$env:METTI_SAM_MODEL = "C:\models\sam2_b.pt"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080
```

For a temporary generic-removal experiment only:

```powershell
$env:METTI_PROCESSOR_API_KEY = "local-only-secret"
$env:METTI_PROCESSOR_BACKEND = "rembg"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080
```

The model packages may download weights on first use depending on their model
configuration. In production, bake or mount reviewed weights and disable
outbound model downloads at the container/network layer.

## Container

```powershell
docker build -t metti-image-processor .
docker run --rm -p 8080:8080 `
  -e METTI_PROCESSOR_API_KEY="replace-me" `
  -e METTI_PROCESSOR_BACKEND=grounded_sam2 `
  -e METTI_DETECTOR_MODEL=/models/yolov8s-worldv2.pt `
  -e METTI_SAM_MODEL=/models/sam2_b.pt `
  -v "C:\models:/models:ro" `
  metti-image-processor
```

`GET /healthz` reports `503` until authentication and model weights are ready.
`POST /process` is the only image endpoint. Require the API key at the private
network boundary as well as in the service.

## Contract smoke test

```powershell
curl.exe -X POST http://127.0.0.1:8080/process `
  -H "Authorization: Bearer local-only-secret" `
  -F "image_file=@C:\photos\glasses.jpg" `
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

The response shape is documented in
[`docs/IMAGE_PROCESSING.md`](../../docs/IMAGE_PROCESSING.md). The caller must
reject a result without quality evidence; that rule is also enforced by the
shared Supabase service.
