$ErrorActionPreference='Stop'
$runtimePath=Join-Path $PSScriptRoot '.local/runtime.json'
if(-not (Test-Path -LiteralPath $runtimePath)){Write-Output 'Local service is not running.';return}
$r=Get-Content -LiteralPath $runtimePath -Raw -Encoding utf8|ConvertFrom-Json
$uri=[Uri]$r.url
if($uri.Host -ne '127.0.0.1' -or $uri.Scheme -ne 'http'){throw 'Unexpected local endpoint'}
Invoke-RestMethod -Uri ($r.url+'/api/shutdown') -Method Post -Headers @{Authorization=('Bearer '+$r.token)} -ContentType 'application/json' -Body '{}' -TimeoutSec 5|Out-Null
Write-Output 'Stopped Agent Handoff local service. WorkBuddy stays open.'
