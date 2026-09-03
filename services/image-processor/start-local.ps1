[CmdletBinding()]
param(
    [int]$Port = 8080,
    [switch]$WaitForHealth
)

$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateRoot = Join-Path $env:LOCALAPPDATA "Metti\image-processor"
$secretPath = Join-Path $stateRoot "secrets\processor-upstream.key"
$logRoot = Join-Path $stateRoot "logs"

if (-not (Test-Path -LiteralPath $secretPath)) {
    throw "Local processor secret is missing: $secretPath"
}

$apiKey = (Get-Content -LiteralPath $secretPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "Local processor secret is empty: $secretPath"
}

$pythonCandidates = @(
    $env:METTI_PROCESSOR_PYTHON,
    (Join-Path $serviceRoot ".venv\Scripts\python.exe"),
    (Join-Path $env:TEMP "metti-processor-venv\Scripts\python.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if (-not $pythonCandidates) {
    throw "No Python environment found. Set METTI_PROCESSOR_PYTHON or create services/image-processor/.venv."
}

$python = $pythonCandidates | Select-Object -First 1
$modelRoot = if ($env:METTI_PROCESSOR_MODEL_ROOT) {
    $env:METTI_PROCESSOR_MODEL_ROOT
} else {
    Join-Path $env:TEMP "metti-processor-models"
}
$samModel = if ($env:METTI_SAM_MODEL) {
    $env:METTI_SAM_MODEL
} else {
    Join-Path $modelRoot "sam2_b.pt"
}
$u2netRoot = Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter "metti-local-rembg-*" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$env:METTI_PROCESSOR_API_KEY = $apiKey
$env:METTI_PROCESSOR_ALLOW_ANONYMOUS = "false"
$env:METTI_PROCESSOR_BACKEND = if ($env:METTI_PROCESSOR_BACKEND) { $env:METTI_PROCESSOR_BACKEND } else { "grounding_dino_sam2" }
$env:METTI_DETECTOR_MODEL = if ($env:METTI_DETECTOR_MODEL) { $env:METTI_DETECTOR_MODEL } else { "IDEA-Research/grounding-dino-tiny" }
$env:METTI_SAM_MODEL = $samModel
$env:METTI_MATTING_MODEL = if ($env:METTI_MATTING_MODEL) { $env:METTI_MATTING_MODEL } else { "u2net" }
$env:METTI_MATTING_ENABLED = if ($env:METTI_MATTING_ENABLED) { $env:METTI_MATTING_ENABLED } else { "true" }
$env:HF_HOME = if ($env:HF_HOME) { $env:HF_HOME } else { Join-Path $env:USERPROFILE ".cache\huggingface" }
if ($u2netRoot) {
    $env:U2NET_HOME = Join-Path $u2netRoot "models"
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    Write-Output "Metti image processor is already listening on 127.0.0.1:$Port (PID $($listener.OwningProcess))."
    exit 0
}

$stdoutPath = Join-Path $logRoot "processor.stdout.log"
$stderrPath = Join-Path $logRoot "processor.stderr.log"
$arguments = @(
    "-m", "uvicorn", "app.main:app",
    "--host", "127.0.0.1",
    "--port", "$Port"
)
$process = Start-Process `
    -WindowStyle Hidden `
    -WorkingDirectory $serviceRoot `
    -FilePath $python `
    -ArgumentList $arguments `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

Write-Output "Started Metti image processor (PID $($process.Id)) on 127.0.0.1:$Port."

if ($WaitForHealth) {
    $deadline = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 2
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                Write-Output "Metti image processor is healthy."
                exit 0
            }
        } catch {
            # Model loading can take a few minutes on the first start.
        }
    } while ((Get-Date) -lt $deadline)
    throw "Metti image processor did not become healthy. See $stderrPath"
}
