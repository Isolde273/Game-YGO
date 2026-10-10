param([switch]$TestOnly, [switch]$Catalog)
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reviewUrl = if ($Catalog) { 'http://127.0.0.1:5173/public/locr-catalog/index.html' } else { 'http://127.0.0.1:5173/public/material-review/index.html' }
$pageScript = if ($Catalog) { '../../src/ui/locr-catalog.js' } else { './review.js' }
function Test-ReviewPage {
    try {
        $page = Invoke-WebRequest -Uri $reviewUrl -UseBasicParsing -TimeoutSec 2
        return $page.StatusCode -eq 200 -and $page.Content.Contains($pageScript)
    } catch { return $false }
}
if (-not (Test-ReviewPage)) {
    $runtime = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodeExecutable = if ($runtime) { $runtime.Source } else { Join-Path $taskRoot 'portable\游戏王开盒模拟器\游戏王开盒模拟器.exe' }
    if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw '未找到本机 Node.js 或绿色版运行时。' }
    $entry = Join-Path $taskRoot 'scripts\serve.mjs'
    $savedElectronFlag = $env:ELECTRON_RUN_AS_NODE
    try {
        if (-not $runtime) { $env:ELECTRON_RUN_AS_NODE = '1' }
        Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $entry + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden | Out-Null
    } finally { $env:ELECTRON_RUN_AS_NODE = $savedElectronFlag }
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 200
        if (Test-ReviewPage) { $ready = $true; break }
    }
    if (-not $ready) { throw '审查页启动失败，请检查本机 5173 端口。' }
}
if (-not $TestOnly) { Start-Process $reviewUrl }
Write-Output $reviewUrl
