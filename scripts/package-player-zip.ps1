param([string]$GameDirectory='D:/游戏王实卡开盒模拟器', [string]$ZipPath='', [string]$BeforeRoot='')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ProjectRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$GameDirectory=[System.IO.Path]::GetFullPath($GameDirectory).TrimEnd('\')
if (-not $ZipPath) { $ZipPath=$GameDirectory+'.zip' }
$ZipPath=[System.IO.Path]::GetFullPath($ZipPath)
if ([System.IO.Path]::GetExtension($ZipPath) -ne '.zip' -or $ZipPath.StartsWith($GameDirectory+'\')) { throw 'Invalid ZIP output path' }
$BaseName=Split-Path -Leaf $GameDirectory
$Output=Join-Path $ProjectRoot 'test-results\player-size-lossless-20261010'
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$TemporaryZip=Join-Path (Split-Path -Parent $ZipPath) ('.player-zip-'+[guid]::NewGuid().ToString('N')+'.zip')
function Get-StreamHash($Stream) {
  $Hasher=[System.Security.Cryptography.SHA256]::Create()
  try { return [System.BitConverter]::ToString($Hasher.ComputeHash($Stream)) }
  finally { $Hasher.Dispose() }
}
function Write-GameZip([string]$ArchivePath, $Files) {
  $Stream=[System.IO.File]::Create($ArchivePath)
  $Archive=New-Object System.IO.Compression.ZipArchive($Stream,[System.IO.Compression.ZipArchiveMode]::Create,$false,[System.Text.Encoding]::UTF8)
  try {
    foreach($File in $Files) {
      $Entry=$Archive.CreateEntry(($BaseName+'/'+$File.Relative.Replace('\','/')),[System.IO.Compression.CompressionLevel]::Optimal)
      $InputStream=[System.IO.File]::OpenRead($File.Source)
      $EntryStream=$Entry.Open()
      try { $InputStream.CopyTo($EntryStream) }
      finally { $EntryStream.Dispose(); $InputStream.Dispose() }
    }
  }
  finally { $Archive.Dispose(); $Stream.Dispose() }
}
function Test-GameZip([string]$ArchivePath, $Files) {
  $Archive=[System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    if ($Archive.Entries.Count -ne $Files.Count) { throw 'ZIP file count differs' }
    foreach($File in $Files) {
      $Entry=$Archive.GetEntry($BaseName+'/'+$File.Relative.Replace('\','/'))
      if (-not $Entry -or $Entry.Length -ne $File.Bytes) { throw ('ZIP file differs: '+$File.Relative) }
      $EntryStream=$Entry.Open()
      $SourceStream=[System.IO.File]::OpenRead($File.Source)
      try { if ((Get-StreamHash $EntryStream) -ne (Get-StreamHash $SourceStream)) { throw ('ZIP hash differs: '+$File.Relative) } }
      finally { $EntryStream.Dispose(); $SourceStream.Dispose() }
    }
  }
  finally { $Archive.Dispose() }
}
$Files=@(Get-ChildItem -LiteralPath $GameDirectory -Recurse -File | Sort-Object FullName | ForEach-Object { [pscustomobject]@{Source=$_.FullName;Relative=$_.FullName.Substring($GameDirectory.Length+1);Bytes=$_.Length} })
Write-GameZip $TemporaryZip $Files
Test-GameZip $TemporaryZip $Files
if (Test-Path -LiteralPath $ZipPath) { Move-Item -LiteralPath $ZipPath -Destination (Join-Path $Output ('zip-before-'+[guid]::NewGuid().ToString('N')+'.zip')) }
Move-Item -LiteralPath $TemporaryZip -Destination $ZipPath
$Report=[ordered]@{ Zip=$ZipPath;Bytes=(Get-Item -LiteralPath $ZipPath).Length;ExtractedBytes=($Files | Measure-Object Bytes -Sum).Sum;Files=$Files.Count;AllEntryHashesMatch=$true;DevelopmentFilesIncluded=$false }
Write-Output ('ZIP已生成并逐文件校验：'+$ZipPath)
if ($BeforeRoot) {
  $BeforeRoot=[System.IO.Path]::GetFullPath($BeforeRoot).TrimEnd('\')
  $BeforeFiles=@($Files | Where-Object { $_.Relative -ne 'resources\app.asar' -and -not $_.Relative.StartsWith('locales\') })
  $BeforeFiles+=@(Get-ChildItem -LiteralPath $BeforeRoot -File -Recurse | ForEach-Object { [pscustomobject]@{Source=$_.FullName;Relative=$_.FullName.Substring($BeforeRoot.Length+1);Bytes=$_.Length} })
  $Expected=Get-Content -LiteralPath (Join-Path $Output 'before.json') -Encoding UTF8 -Raw | ConvertFrom-Json
  if (($BeforeFiles | Measure-Object Bytes -Sum).Sum -ne $Expected.Bytes -or $BeforeFiles.Count -ne $Expected.Files) { throw 'Original package reconstruction differs' }
  $BaselineZip=Join-Path $Output 'before-same-compression.zip'
  if (-not (Test-Path -LiteralPath $BaselineZip)) { Write-GameZip $BaselineZip $BeforeFiles }
  Test-GameZip $BaselineZip $BeforeFiles
  $Report.BeforeZipBytes=(Get-Item -LiteralPath $BaselineZip).Length
  $Report.BeforeExtractedBytes=$Expected.Bytes
  $Report.SavedZipBytes=$Report.BeforeZipBytes-$Report.Bytes
  $Report.SavedExtractedBytes=$Report.BeforeExtractedBytes-$Report.ExtractedBytes
}
$Report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'zip.json') -Encoding UTF8
$Report | ConvertTo-Json -Compress | Write-Output
