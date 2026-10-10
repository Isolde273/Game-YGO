param([string]$Runtime='', [string]$OutputDirectory='', [string]$ApplicationName='游戏王开盒模拟器', [switch]$PlayerRelease)
$ErrorActionPreference='Stop'
function Get-PackageHash([string]$File) {
  $Stream=[System.IO.File]::OpenRead($File)
  $Hasher=[System.Security.Cryptography.SHA256]::Create()
  try { return [System.BitConverter]::ToString($Hasher.ComputeHash($Stream)) }
  finally { $Hasher.Dispose(); $Stream.Dispose() }
}
$ProjectRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$DefaultDestination=[System.IO.Path]::GetFullPath((Join-Path $ProjectRoot 'portable\游戏王开盒模拟器'))
$Destination=if ($OutputDirectory) { [System.IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\') } else { $DefaultDestination }
if ($Destination -eq $ProjectRoot -or $Destination -eq [System.IO.Path]::GetPathRoot($Destination).TrimEnd('\')) { throw 'Invalid output path' }
if (-not $ApplicationName -or $ApplicationName.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $ApplicationName -match '^(\.|\.\.|CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$' -or $ApplicationName.EndsWith('.') -or $ApplicationName.EndsWith(' ')) { throw 'Invalid application name' }
$ApplicationExe=$ApplicationName+'.exe'
if (-not $Runtime) {
  if ($env:YGO_ELECTRON_RUNTIME) { $Runtime=$env:YGO_ELECTRON_RUNTIME }
  elseif (Test-Path -LiteralPath (Join-Path $Destination $ApplicationExe)) { $Runtime=$Destination }
  elseif (Test-Path -LiteralPath (Join-Path $DefaultDestination '游戏王开盒模拟器.exe')) { $Runtime=$DefaultDestination }
  else { throw '找不到 Electron 运行时，请使用 -Runtime 指定包含 electron.exe 的目录。' }
}
$Runtime=[System.IO.Path]::GetFullPath($Runtime)
$RuntimeExe=Join-Path $Runtime 'electron.exe'
if (-not (Test-Path -LiteralPath $RuntimeExe)) { $RuntimeExe=Join-Path $Runtime '游戏王开盒模拟器.exe' }
if (-not (Test-Path -LiteralPath $RuntimeExe)) { $RuntimeExe=Join-Path $Runtime $ApplicationExe }
if (-not (Test-Path -LiteralPath $RuntimeExe)) { throw '指定目录中没有 Electron 可执行文件。' }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
if ($Runtime -ne $Destination) {
  Get-ChildItem -LiteralPath $Runtime -File | Where-Object { $_.Name -notin @('TXZ.exe','electron.exe','游戏王开盒模拟器.exe',$ApplicationExe,'README.txt','debug.log') -and (-not $PlayerRelease -or $_.Extension -in @('.dll','.pak','.dat','.bin','.json') -or $_.Name -in @('LICENSE','LICENSES.chromium.html','version')) } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Force }
  Copy-Item -LiteralPath $RuntimeExe -Destination (Join-Path $Destination $ApplicationExe) -Force
  Copy-Item -LiteralPath (Join-Path $Runtime 'locales') -Destination $Destination -Recurse -Force
}
$AppRoot=Join-Path $Destination $(if ($PlayerRelease) { 'resources\app.asar' } else { 'resources\app' })
$Stage=Join-Path $Destination ('resources\.app-stage-'+[guid]::NewGuid().ToString('N'))
$PackedStage=$Stage+'.asar'
$HistoryRoot=[System.IO.Path]::GetFullPath((Join-Path $ProjectRoot 'test-results\package-history'))
$Previous=Join-Path $HistoryRoot ('app-before-'+[guid]::NewGuid().ToString('N')+$(if ($PlayerRelease) { '.asar' } else { '' }))
$PackedSource=Join-Path $HistoryRoot ('packed-source-'+[guid]::NewGuid().ToString('N'))
$PlayerExtras=Join-Path $HistoryRoot ('player-extras-'+[guid]::NewGuid().ToString('N'))
$FailedStage=Join-Path $HistoryRoot ('incomplete-'+[guid]::NewGuid().ToString('N'))
foreach($Candidate in @($AppRoot,$Stage,$PackedStage)) {
  $Resolved=[System.IO.Path]::GetFullPath($Candidate)
  if (-not $Resolved.StartsWith($Destination+'\resources\')) { throw 'Invalid application directory' }
}
foreach($Candidate in @($Previous,$FailedStage,$PackedSource,$PlayerExtras)) {
  $Resolved=[System.IO.Path]::GetFullPath($Candidate)
  if (-not $Resolved.StartsWith($ProjectRoot+'\test-results\package-history\')) { throw 'Invalid package history directory' }
}
New-Item -ItemType Directory -Path $HistoryRoot -Force | Out-Null
try {
  New-Item -ItemType Directory -Path $Stage -Force | Out-Null
  foreach($Name in @('index.html','package.json','src','desktop')) { Copy-Item -LiteralPath (Join-Path $ProjectRoot $Name) -Destination $Stage -Recurse -Force }
  if ($PlayerRelease) {
    $PublicStage=Join-Path $Stage 'public'
    New-Item -ItemType Directory -Path $PublicStage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'public\assets') -Destination $PublicStage -Recurse -Force
    foreach($Catalog in @('locr-catalog','vol2-catalog')) {
      $CatalogSource=Join-Path $ProjectRoot ('public\'+$Catalog)
      $CatalogStage=Join-Path $PublicStage $Catalog
      New-Item -ItemType Directory -Path $CatalogStage -Force | Out-Null
      Copy-Item -LiteralPath (Join-Path $CatalogSource 'assets') -Destination $CatalogStage -Recurse -Force
      Get-ChildItem -LiteralPath $CatalogSource -File -Filter '*.json' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $CatalogStage -Force }
    }
  }
  else { Copy-Item -LiteralPath (Join-Path $ProjectRoot 'public') -Destination $Stage -Recurse -Force }
  foreach($SourceFile in (Get-ChildItem -LiteralPath $Stage -File -Recurse)) {
    $Relative=$SourceFile.FullName.Substring($Stage.Length+1)
    if ((Get-PackageHash $SourceFile.FullName) -ne (Get-PackageHash (Join-Path $ProjectRoot $Relative))) { throw "打包文件校验失败：$Relative" }
  }
  $StageToInstall=$Stage
  if ($PlayerRelease) {
    & node (Join-Path $ProjectRoot 'scripts\optimize-player-assets.mjs') $Stage
    if ($LASTEXITCODE -ne 0) { throw '游玩版无损资源优化失败' }
    $Metadata=Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
    $PlayerMetadata=@{ name=$Metadata.name; version=$Metadata.version; type='module'; main='desktop/main.mjs'; description=$ApplicationName } | ConvertTo-Json
    [System.IO.File]::WriteAllText((Join-Path $Stage 'package.json'), $PlayerMetadata, (New-Object System.Text.UTF8Encoding($false)))
    & npx.cmd --yes --package '@electron/asar@4.3.1' asar pack $Stage $PackedStage
    if ($LASTEXITCODE -ne 0) { throw '游玩版资源封装失败' }
    Move-Item -LiteralPath $Stage -Destination $PackedSource
    $StageToInstall=$PackedStage
  }
  & node (Join-Path $ProjectRoot 'scripts\apply-executable-icon.mjs') (Join-Path $Destination $ApplicationExe)
  if ($LASTEXITCODE -ne 0) { throw '游戏EXE图标更新失败' }
  if (Test-Path -LiteralPath $AppRoot) { Move-Item -LiteralPath $AppRoot -Destination $Previous }
  try { Move-Item -LiteralPath $StageToInstall -Destination $AppRoot }
  catch {
    if (Test-Path -LiteralPath $Previous) { Move-Item -LiteralPath $Previous -Destination $AppRoot }
    throw
  }
}
finally { if (Test-Path -LiteralPath $Stage) { Move-Item -LiteralPath $Stage -Destination $FailedStage } }
if ($PlayerRelease) {
  $LocalesRoot=Join-Path $Destination 'locales'
  foreach($LocaleFile in (Get-ChildItem -LiteralPath $LocalesRoot -File -Filter '*.pak')) {
    if ($LocaleFile.Name -in @('en-US.pak','en-GB.pak','zh-CN.pak','zh-TW.pak')) { continue }
    if (-not $LocaleFile.FullName.StartsWith($Destination+'\locales\')) { throw 'Invalid locale path' }
    $LocaleArchive=Join-Path $PlayerExtras 'locales'
    New-Item -ItemType Directory -Path $LocaleArchive -Force | Out-Null
    Move-Item -LiteralPath $LocaleFile.FullName -Destination (Join-Path $LocaleArchive $LocaleFile.Name)
  }
  foreach($Extra in @('docs','使用说明.md','素材来源.md','验证说明.md','启动游戏.cmd','debug.log','.obsidian','resources\app')) {
    $ExtraPath=[System.IO.Path]::GetFullPath((Join-Path $Destination $Extra))
    if (-not $ExtraPath.StartsWith($Destination+'\')) { throw 'Invalid extra path' }
    if (Test-Path -LiteralPath $ExtraPath) {
      New-Item -ItemType Directory -Path $PlayerExtras -Force | Out-Null
      Move-Item -LiteralPath $ExtraPath -Destination (Join-Path $PlayerExtras ($Extra.Replace('\','-')))
    }
  }
  Write-Output "纯游玩版已生成：$Destination"
  exit 0
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'README.md') -Destination (Join-Path $Destination '使用说明.md') -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'ASSETS.md') -Destination (Join-Path $Destination '素材来源.md') -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'VERIFICATION.md') -Destination (Join-Path $Destination '验证说明.md') -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'docs') -Destination $Destination -Recurse -Force
if ($OutputDirectory) {
  $Launcher=@"
@echo off
chcp 65001 >nul
setlocal
set "ELECTRON_RUN_AS_NODE="
set "YGO_SMOKE_TEST="
set "YGO_SMOKE_USERDATA="
start "" /D "%~dp0" "%~dp0$ApplicationExe"
"@
  [System.IO.File]::WriteAllText((Join-Path $Destination '启动游戏.cmd'), $Launcher+"`r`n", (New-Object System.Text.UTF8Encoding($false)))
  $PlayerGuide=@"
# $ApplicationName

双击 $ApplicationExe 或 启动游戏.cmd 开始游戏。

这是完整的Windows离线游玩版，无需安装Node.js或启动开发服务器。
移动或分享时请保留整个文件夹，程序依赖同目录的resources、locales和运行库文件。

## 操作

- 在购买页的手机里购买卡包、卡盒或整箱；打工每次+500，冷却1秒。
- 在开盒空间双击包装拆封，右键可批量拆封，滚轮调整缩放。
- 点击桌面卡堆进入整理界面；卡牌向右摊开，摊开完成后可以拿取。
- 将单卡拖到左侧暂存区或右侧仓库，也可以用界面按钮整理。
- 收藏册、仓库和设置可从主菜单进入，设置里可导出和导入存档。

## 存档

存档位置仍为 %APPDATA%\YGO-Duel-Archive，与开发目录的启动游戏.cmd使用同一存档位置。
复制或更新游戏文件不会搬迁存档。更新前完全退出游戏，重要进度可先在设置中导出。
"@
  [System.IO.File]::WriteAllText((Join-Path $Destination '使用说明.md'), $PlayerGuide+"`r`n", (New-Object System.Text.UTF8Encoding($false)))
}
Write-Output "绿色版已生成：$Destination"
