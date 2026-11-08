param([switch]$Yes)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$owned=[IO.Path]::GetFullPath((Join-Path $tempRoot ('agent-handoff-uninstall-'+[guid]::NewGuid().ToString('N'))))
if(-not $owned.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected temporary path'}
$null=New-Item -ItemType Directory -Path $owned
$node=Join-Path $owned 'node.exe'
try{
 Copy-Item -LiteralPath (Join-Path $root 'runtime/node.exe') -Destination $node
 $options=@((Join-Path $root 'scripts/setup.mjs'),'uninstall')
 if($Yes){$options+='--yes'}
 & $node @options
 $result=$LASTEXITCODE
}finally{
 if(Test-Path -LiteralPath $node){Remove-Item -LiteralPath $node}
 Remove-Item -LiteralPath $owned
}
exit $result
