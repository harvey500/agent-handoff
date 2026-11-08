param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$runtimePath=Join-Path $PSScriptRoot '.local/runtime.json'
$url=$null
if(Test-Path -LiteralPath $runtimePath){
  try{
    $r=Get-Content -LiteralPath $runtimePath -Raw -Encoding utf8|ConvertFrom-Json
    $uri=[Uri]$r.url
    if($uri.Host -ne '127.0.0.1'){throw 'Unexpected host'}
    Invoke-RestMethod -Uri ($r.url+'/api/state') -Headers @{Authorization=('Bearer '+$r.token)} -TimeoutSec 2|Out-Null
    $url=$r.url
  }catch{}
}
if(-not $url){
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $entry=Join-Path $PSScriptRoot 'src/server.mjs'
  $local=Join-Path $PSScriptRoot '.local'
  New-Item -ItemType Directory -Path $local -Force|Out-Null
  $job=Start-Process -FilePath $node -ArgumentList ('"'+$entry+'"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $local 'server.log') -RedirectStandardError (Join-Path $local 'server-error.log') -PassThru
  $deadline=(Get-Date).AddSeconds(15)
  do{
    Start-Sleep -Milliseconds 300
    if(Test-Path -LiteralPath $runtimePath){
      try{$r=Get-Content -LiteralPath $runtimePath -Raw -Encoding utf8|ConvertFrom-Json;if($r.pid -eq $job.Id){$url=$r.url}}catch{}
    }
  }until($url -or (Get-Date)-gt $deadline)
  if(-not $url){throw 'Local server did not start. See .local/server-error.log.'}
}
if(-not $NoBrowser){Start-Process $url}
Write-Output $url
