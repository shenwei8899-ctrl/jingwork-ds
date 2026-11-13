import { appPath } from '../utils/appPath.js'

export const desktopRelease = {
  "name": "macOS Apple Silicon",
  "description": "macOS 13.0 及以上 · Apple M 系列芯片",
  "icon": appPath("/downloads/apple.svg"),
  "filename": "JingWork-0.2.2-alpha.2.20261111.3-mac-arm64.dmg",
  "url": appPath("/downloads/releases/0.2.2-alpha.2.20261111.3/JingWork-0.2.2-alpha.2.20261111.3-mac-arm64.dmg"),
  "bytes": 275119834,
  "size": "262 MiB",
  "sha256": "8815beb6a0004b187ca4c1d96256d53253845a888ef2bb90a5f59f69ab4681ec",
  "product": "JingWork",
  "version": "0.2.2-alpha.2.20261111.3",
  "date": "2026-11-11",
  "platform": "macOS Apple Silicon",
  "system": "macOS 13.0 及以上 · Apple M 系列芯片",
  "signing": "未经 Apple 公证",
  "status": "内网版"
}

export const otherPlatforms = [
{
  "name": "macOS Intel",
  "description": "Intel 芯片 Mac",
  "icon": appPath("/downloads/apple.svg"),
  "filename": "JingWork-0.2.2-alpha.2.20261111.3-mac-x64.dmg",
  "url": appPath("/downloads/releases/0.2.2-alpha.2.20261111.3/JingWork-0.2.2-alpha.2.20261111.3-mac-x64.dmg"),
  "bytes": 297993767,
  "size": "284 MiB",
  "sha256": "cbb66632b59e741d0cc4e69ef19503e98a7b913e908fb59626274082bb73d348"
},
{
  "name": "Windows x64",
  "description": "Intel / AMD 处理器",
  "icon": appPath("/downloads/windows.svg"),
  "filename": "JingWork-0.2.2-alpha.2.20261111.3-windows-x64.exe",
  "url": appPath("/downloads/releases/0.2.2-alpha.2.20261111.3/JingWork-0.2.2-alpha.2.20261111.3-windows-x64.exe"),
  "bytes": 321823717,
  "size": "307 MiB",
  "sha256": "e7eda78a1de82027f408829184f37feb37587bbbd91d40eda8733637dea2a0ca"
},
{
  "name": "Windows ARM64",
  "description": "Surface 等 ARM 设备",
  "icon": appPath("/downloads/windows.svg"),
  "filename": "JingWork-0.2.2-alpha.2.20261111.3-windows-arm64.exe",
  "url": null,
  "bytes": 0,
  "size": "",
  "sha256": null
}
]

export const checksumUrl = appPath(`/downloads/releases/${desktopRelease.version}/SHA256SUMS`)
