param([Parameter(Mandatory=$true)][string]$Hostname,[string]$OwnerName='owner',[string]$Root='C:\ProgramData\nightwire')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'run this installer from an administrator powershell session'}
$node=(Get-Command node.exe -ErrorAction Stop).Source
$sourceRoot=Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Force -Path $Root,"$Root\bin","$Root\server","$Root\source","$Root\logs" | Out-Null
function Fetch-Verified($Url,$Path,$Hash){
 if((Test-Path $Path) -and ((Get-FileHash $Path -Algorithm SHA256).Hash -eq $Hash)){return}
 Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile "$Path.download" -TimeoutSec 180
 if((Get-FileHash "$Path.download" -Algorithm SHA256).Hash -ne $Hash){throw 'a downloaded component failed its checksum check'}
 Move-Item -Force "$Path.download" $Path
}
$archive="$Root\sing-box.zip"
Fetch-Verified 'https://github.com/SagerNet/sing-box/releases/download/v1.14.4/sing-box-1.14.4-windows-amd64.zip' $archive '99185d75d314a07dbba4a130c8ad986cbeb629a07927975636b341ca61f991df'
$extract="$Root\unpacked"
Expand-Archive -Path $archive -DestinationPath $extract -Force
$exe=Get-ChildItem $extract -Recurse -Filter sing-box.exe | Select-Object -First 1
if(-not $exe){throw 'the backend archive did not contain the expected executable'}
Copy-Item -Force $exe.FullName "$Root\bin\sing-box.exe"
Get-ChildItem $extract -Recurse -Filter LICENSE | Select-Object -First 1 | ForEach-Object {Copy-Item -Force $_.FullName "$Root\bin\sing-box-license.txt"}
Fetch-Verified 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe' "$Root\nightwire-service.exe" 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f'
Copy-Item -Force "$sourceRoot\server\admin.mjs" "$Root\server\admin.mjs"
Copy-Item -Force "$sourceRoot\source\config.mjs" "$Root\source\config.mjs"
@'
<service>
 <id>nightwire</id>
 <name>nightwire home gateway</name>
 <description>the home end of your nightwire connections.</description>
 <executable>%BASE%\bin\sing-box.exe</executable>
 <arguments>run -c "%BASE%\config.json"</arguments>
 <workingdirectory>%BASE%</workingdirectory>
 <serviceaccount><username>NT AUTHORITY\LocalService</username></serviceaccount>
 <startmode>Automatic</startmode>
 <onfailure action="restart" delay="10 sec"/>
 <stoptimeout>15 sec</stoptimeout>
 <logpath>%BASE%\logs</logpath>
 <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>3</keepFiles></log>
</service>
'@ | Set-Content -Encoding UTF8 "$Root\nightwire-service.xml"
if(-not (Test-Path "$Root\private\users.json")){
 & $node "$Root\server\admin.mjs" init --dir $Root --hostname $Hostname --name $OwnerName --no-restart
 if($LASTEXITCODE -ne 0){throw 'server initialization failed'}
}
& "$Root\bin\sing-box.exe" check -c "$Root\config.json"
if($LASTEXITCODE -ne 0){throw 'server configuration failed validation'}
icacls.exe $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
if($LASTEXITCODE -ne 0){throw 'server permissions could not be restricted'}
icacls.exe "$Root\logs" /grant:r '*S-1-5-19:(OI)(CI)M' | Out-Null
if($LASTEXITCODE -ne 0){throw 'log permissions could not be set'}
if(-not (Get-Service nightwire -ErrorAction SilentlyContinue)){& "$Root\nightwire-service.exe" install;if($LASTEXITCODE -ne 0){throw 'windows service installation failed'}}
Set-Service nightwire -StartupType Automatic
Start-Service nightwire
Get-Service nightwire | Select-Object Name,Status,StartType
Write-Output 'the gateway is local-only until its cloudflare hostname is configured'
