$ErrorActionPreference = "Stop"

$repo = "jwwsjlm/douyinLive"
$targetDir = Join-Path $PSScriptRoot "..\vendor\douyinlive"
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -match "windows-amd64\.zip$" } | Select-Object -First 1
if (-not $asset) {
    throw "最新发布中没有windows-amd64.zip"
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
$zipPath = Join-Path $targetDir $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
Expand-Archive -LiteralPath $zipPath -DestinationPath $targetDir -Force
Remove-Item -LiteralPath $zipPath

$binary = Get-ChildItem -LiteralPath $targetDir -Filter "douyinLive.exe" -Recurse | Select-Object -First 1
if (-not $binary) {
    throw "压缩包中没有douyinLive.exe"
}
$targetBinary = Join-Path $targetDir "douyinLive.exe"
if ([IO.Path]::GetFullPath($binary.FullName) -ne [IO.Path]::GetFullPath($targetBinary)) {
    Copy-Item -LiteralPath $binary.FullName -Destination $targetBinary -Force
}

$notice = @"
douyinLive
Source: https://github.com/jwwsjlm/douyinLive
Release: $($release.tag_name)
License: MIT
Installed: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
"@
Set-Content -LiteralPath (Join-Path $targetDir "THIRD_PARTY_NOTICE.txt") -Value $notice -Encoding UTF8
Write-Output "installed=$($release.tag_name)"
