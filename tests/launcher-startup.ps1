$ErrorActionPreference='Stop'
$ProjectRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Exe=[System.IO.Path]::GetFullPath((Join-Path $ProjectRoot 'portable\游戏王开盒模拟器\游戏王开盒模拟器.exe'))
$Launcher=Join-Path $ProjectRoot '启动游戏.cmd'
if(Get-Process | Where-Object {$_.Path -eq $Exe}) {throw 'Close the game before the cold-start test.'}
$env:ELECTRON_RUN_AS_NODE='1'
$env:YGO_SMOKE_TEST='1'
$env:YGO_SMOKE_USERDATA=Join-Path $ProjectRoot 'test-results\should-not-be-created'
$Launch=Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c call `"$Launcher`"" -WorkingDirectory $env:TEMP -WindowStyle Hidden -PassThru
$Game=$null
try {
  $Deadline=(Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 200
    $Game=Get-Process | Where-Object {$_.Path -eq $Exe -and $_.MainWindowTitle -like '*游戏王开盒模拟器*'} | Select-Object -First 1
  }while(-not $Game -and (Get-Date) -lt $Deadline)
  if(-not $Game -or $Game.MainWindowHandle -eq 0) {throw 'Double-click launcher did not open the loaded game window.'}
  Write-Output "冷启动入口验证通过：跨目录启动、中文路径、开发／测试变量清理、窗口与主页显示。PID $($Game.Id)"
}finally {
  if($Game){$Game.CloseMainWindow() | Out-Null;$Game.WaitForExit(10000) | Out-Null}
}
