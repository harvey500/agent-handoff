$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new()
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class HandoffClaudeWindows {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int L,T,R,B;}
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb,IntPtr p);
 [DllImport("user32.dll")] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 public static List<long> List(int id){
  var result=new List<long>();EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);
   if(owner==(uint)id){var c=new StringBuilder(256);GetClassName(h,c,256);Rect r;GetWindowRect(h,out r);
    if(c.ToString()=="Chrome_WidgetWin_1")result.Add(h.ToInt64());}return true;},IntPtr.Zero);return result;
 }
}
'@
$main=@(Get-CimInstance Win32_Process -Filter "Name='claude.exe'"|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.Replace([char]92,[char]47) -match '/AnthropicClaude/app-[^/]+/claude.exe$' -and $_.CommandLine -notmatch '--type='})
$choice=@()
foreach($process in $main){
 foreach($handle in [HandoffClaudeWindows]::List([int]$process.ProcessId)){
  try{
   $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)
   $documents=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty),([System.Windows.Automation.ControlType]::Document)))
   foreach($doc in $documents){$pattern=$null;if($doc.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
    $uri=$pattern.Current.Value
    if($uri -like 'app://localhost/*' -or $uri -like 'https://claude.ai/*'){$choice+=[pscustomobject]@{Root=$root;Document=$doc;Url=$uri;Process=$process;Handle=$handle};break}
   }}
  }catch{}
 }
}
if($choice.Count -ne 1){throw ('Expected one ready Claude chat window, found '+$choice.Count+'. Open Claude and finish loading/sign-in.')}
$selected=$choice[0]
$root=$selected.Root
$version=(Get-Item -LiteralPath $selected.Process.ExecutablePath).VersionInfo.ProductVersion
if($version -ne $request.expectedVersion){throw 'Claude version has not been validated'}
$requiredFlags=@('--force-renderer-accessibility','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-background-timer-throttling')
$missingFlags=@($requiredFlags|Where-Object {$selected.Process.CommandLine -notmatch ('(?:^|\s)'+[regex]::Escape($_)+'(?:\s|$)')})
function Elements {return $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)}
function DocumentState {
 $docs=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty),([System.Windows.Automation.ControlType]::Document)))
 foreach($doc in $docs){$p=$null;if($doc.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p) -and ($p.Current.Value -like 'app://localhost/*' -or $p.Current.Value -like 'https://claude.ai/*')){return [pscustomobject]@{Element=$doc;Url=$p.Current.Value;Name=$doc.Current.Name}}}
 throw 'Claude chat document is not ready'
}
function Composer {
 $items=Elements
 $found=@()
 foreach($item in $items){if($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $item.Current.Name -in @('向 Claude 输入你的提示词','Write your prompt to Claude','Reply to Claude','Message Claude')){$found+=$item}}
 if($found.Count -ne 1){throw 'Expected one Claude composer'}
 return $found[0]
}
function FindSend {
 foreach($item in (Elements)){if($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $item.Current.Name -in @('Start task','Send message','发送消息','发送')){return $item}}
 return $null
}
function IsBusy {
 foreach($item in (Elements)){if($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $item.Current.Name -in @('停止回复','Stop response','Stop generating') -and $item.Current.IsEnabled){return $true}}
 return $false
}
function DraftValue {
 $editor=Composer
 $value=[System.Windows.Automation.ValuePattern]$editor.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
 $text=$value.Current.Value
 $send=FindSend
 if($text.Trim() -in @('写一条消息…','Write a message…','Reply to Claude...') -and $send -and -not $send.Current.IsEnabled){return ''}
 return $text
}
function InvokeControl($element){([System.Windows.Automation.InvokePattern]$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()}
function CurrentSession {
 $doc=DocumentState
 $id=$null
 if($doc.Url -match '/cowork/local_([0-9a-f-]{36})'){$id=$Matches[1]}
 return $id
}
function AssertProfile {
 $children=@(Get-CimInstance Win32_Process -Filter ("Name='claude.exe' AND ParentProcessId="+$selected.Process.ProcessId))
 $profiles=@()
 foreach($child in $children){if($child.CommandLine -match '--user-data-dir=(?:"([^"]+)"|([^ ]+))'){$profiles+=if($Matches[1]){$Matches[1]}else{$Matches[2]}}}
 $profile=@($profiles|Select-Object -Unique)
 if($profile.Count -ne 1){throw 'Unable to determine active Claude data profile'}
 if($request.profileRoot -and [IO.Path]::GetFullPath($request.profileRoot).TrimEnd([char]92) -ne [IO.Path]::GetFullPath($profile[0]).TrimEnd([char]92)){throw 'Claude active profile changed'}
 if($request.accountId){$config=Get-Content -LiteralPath (Join-Path $profile[0] 'config.json') -Raw -Encoding utf8|ConvertFrom-Json;if($config.lastKnownAccountUuid -ne $request.accountId){throw 'Claude active account changed'}}
 return $profile[0]
}
$profile=AssertProfile
$action=$request.action
if($action -eq 'status'){
 $doc=DocumentState
 [pscustomobject]@{version=$version;executable=$selected.Process.ExecutablePath;pid=$selected.Process.ProcessId;profileRoot=$profile;url=$doc.Url;title=$doc.Name;currentId=(CurrentSession);busy=(IsBusy);draftPresent=[bool](([string](DraftValue)).Trim());automation=@{transport='windows-uia';launchReady=($missingFlags.Count -eq 0);missingLaunchFlags=$missingFlags;focusMayChange=$true;fullyBackgroundVerified=$false}}|ConvertTo-Json -Depth 4 -Compress
 exit
}
if($action -eq 'open'){
 if((CurrentSession) -eq $request.nativeId){[pscustomobject]@{id=$request.nativeId;opened=$true}|ConvertTo-Json -Compress;exit}
 if((DraftValue).Trim()){throw 'Current Claude conversation has an unsent draft'}
 $buttons=@()
 foreach($e in (Elements)){if($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button){$name=$e.Current.Name;if(($name -eq $request.title -or $name.EndsWith(' '+$request.title)) -and $name -notmatch '更多选项|重命名|more options|rename'){$buttons+=$e}}}
 if($buttons.Count -ne 1){throw 'Exact recipient is not uniquely available in Claude sidebar; use its normal search to reveal the chat'}
 InvokeControl $buttons[0]
 $deadline=(Get-Date).AddSeconds(5)
 do{Start-Sleep -Milliseconds 150;if((CurrentSession) -eq $request.nativeId){[pscustomobject]@{id=$request.nativeId;opened=$true}|ConvertTo-Json -Compress;exit}}while((Get-Date)-lt $deadline)
 throw 'Claude navigation did not reach the expected session ID'
}
if($action -eq 'create'){
 if((DraftValue).Trim()){throw 'Claude has an unsent draft; refusing to create another chat'}
 if(IsBusy){throw 'Claude is busy; not creating another chat'}
 $buttons=@((Elements)|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -in @('新建','New chat','New')})
 if($buttons.Count -ne 1){throw 'Claude new-chat button is ambiguous or unavailable'}
 InvokeControl $buttons[0]
 $deadline=(Get-Date).AddSeconds(5)
 do{Start-Sleep -Milliseconds 150;if(-not(CurrentSession)){[pscustomobject]@{newChat=$true;url=(DocumentState).Url}|ConvertTo-Json -Compress;exit}}while((Get-Date)-lt $deadline)
 throw 'Claude did not open a new chat'
}
if($action -notin @('stage','dispatch')){throw 'Unknown Claude operation'}
if($missingFlags.Count -gt 0){throw 'Claude automatic send needs the validated launch flags. Quit normally, then use Start-Claude-Handoff.ps1. No automatic restart or send was attempted.'}
$doc=DocumentState
if($request.newChat){if(CurrentSession){throw 'Expected a new Claude chat'}}elseif((CurrentSession) -ne $request.nativeId){throw 'Claude active conversation changed'}
if(IsBusy){throw 'Claude target is busy'}
if(-not $request.text -or $request.text.Length -gt 64000){throw 'Invalid message length'}
if($action -eq 'stage'){
 if((DraftValue).Trim()){throw 'Claude target contains an unsent draft'}
 $beforeText=([System.Windows.Automation.TextPattern]$doc.Element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)).DocumentRange.GetText(200000)
 if($beforeText.Contains($request.marker)){throw 'Marker already present; reconcile the receipt before any retry'}
 $editor=Composer
 $value=[System.Windows.Automation.ValuePattern]$editor.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
 $value.SetValue([string]$request.text)
 $deadline=(Get-Date).AddSeconds(6)
 $stable=0
 do{
  Start-Sleep -Milliseconds 250
  $send=FindSend
  if($send -and $send.Current.IsEnabled -and (DraftValue).TrimEnd() -eq ([string]$request.text).TrimEnd()){$stable++}else{$stable=0}
  if($stable -ge 2){[pscustomobject]@{staged=$true;nativeId=(CurrentSession);invokedOnce=$false}|ConvertTo-Json -Compress;exit}
 }while((Get-Date)-lt $deadline)
 $actual=[string](DraftValue)
 throw ('Claude draft did not become stable; no send invoked. expectedChars='+$request.text.Length+' actualChars='+$actual.Length+' sendEnabled='+[bool]($send -and $send.Current.IsEnabled)+' focused='+$editor.Current.HasKeyboardFocus)
}
AssertProfile|Out-Null
if($request.newChat){if(CurrentSession){throw 'Claude target changed before dispatch'}}elseif((CurrentSession) -ne $request.nativeId){throw 'Claude target changed before dispatch'}
$current=DraftValue
if($current.TrimEnd() -ne ([string]$request.text).TrimEnd()){throw 'Claude draft changed; not sending'}
$send=FindSend
if(-not $send -or -not $send.Current.IsEnabled){throw 'Claude send button not enabled; no send invoked'}
if((DraftValue).TrimEnd() -ne ([string]$request.text).TrimEnd() -or (IsBusy)){throw 'Claude state changed at dispatch boundary'}
InvokeControl $send
[pscustomobject]@{invokedOnce=$true;nativeId=(CurrentSession);outcome='unknown-until-transcript-read'}|ConvertTo-Json -Compress
