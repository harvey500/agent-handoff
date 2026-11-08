param([string]$Executable)
$ErrorActionPreference='Stop'
$running=@(Get-CimInstance Win32_Process -Filter "Name='claude.exe'"|Where-Object {$_.ExecutablePath -like '*AnthropicClaude*'})
if($running.Count -gt 0){throw 'Claude is already running. Quit normally before using this launcher; no process was stopped.'}
if(-not $Executable){
 $candidates=@(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'AnthropicClaude') -Directory -Filter 'app-*'|ForEach-Object {Join-Path $_.FullName 'claude.exe'}|Where-Object {Test-Path -LiteralPath $_ -PathType Leaf})
 $supported=@($candidates|Where-Object {(Get-Item -LiteralPath $_).VersionInfo.ProductVersion -eq '4.4212.0'})
 if($supported.Count -ne 1){throw 'Expected one validated Claude 4.4212.0 installation. Supply -Executable explicitly or validate the new version first.'}
 $Executable=$supported[0]
}
$item=Get-Item -LiteralPath $Executable
if($item.PSIsContainer -or $item.Name -ne 'claude.exe' -or $item.VersionInfo.ProductVersion -ne '4.4212.0'){throw 'Unvalidated Claude executable; not launching.'}
$arguments=@('--force-renderer-accessibility','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-background-timer-throttling')
# This is the interactive recipient, not a hidden helper or a separate profile.
$process=Start-Process -FilePath $item.FullName -ArgumentList $arguments -WindowStyle Normal -PassThru
[pscustomobject]@{pid=$process.Id;version=$item.VersionInfo.ProductVersion;processOnlyFlags=$arguments;focusMayChange=$true}|ConvertTo-Json -Compress
