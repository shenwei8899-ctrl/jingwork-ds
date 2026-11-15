import { appPath } from '../utils/appPath.js'

export const desktopRelease = {
  "name": "macOS Apple Silicon",
  "description": "macOS 13.0 及以上 · Apple M 系列芯片",
  "icon": appPath("/downloads/apple.svg"),
  "filename": "JingWork-0.2.2-rc.2-mac-arm64.dmg",
  "url": appPath("/downloads/releases/0.2.2-rc.2/JingWork-0.2.2-rc.2-mac-arm64.dmg"),
  "bytes": 282849302,
  "size": "270 MiB",
  "sha256": "67919281687bb99c213669f29106036d622d5d2bf6b888fd53f325f405aa9a5d",
  "product": "JingWork",
  "version": "0.2.2-rc.2",
  "date": "2026-11-15",
  "platform": "macOS Apple Silicon",
  "system": "macOS 13.0 及以上 · Apple M 系列芯片",
  "signing": "安装包未签名；macOS 未经 Apple 公证",
  "status": "内网版"
}

export const otherPlatforms = [
{
  "name": "macOS Intel",
  "description": "Intel 芯片 Mac",
  "icon": appPath("/downloads/apple.svg"),
  "filename": "JingWork-0.2.2-rc.2-mac-x64.dmg",
  "url": appPath("/downloads/releases/0.2.2-rc.2/JingWork-0.2.2-rc.2-mac-x64.dmg"),
  "bytes": 305318998,
  "size": "291 MiB",
  "sha256": "3ff9acef7bc817a1c234f7f6c959a64cd9ff238fea7a47400bc3b8f17160dead"
},
{
  "name": "Windows x64",
  "description": "Intel / AMD 处理器",
  "icon": appPath("/downloads/windows.svg"),
  "filename": "JingWork-0.2.2-rc.2-windows-x64.exe",
  "url": appPath("/downloads/releases/0.2.2-rc.2/JingWork-0.2.2-rc.2-windows-x64.exe"),
  "bytes": 328996711,
  "size": "314 MiB",
  "sha256": "7f8381faf81df5cc8cd1c14cd086359ce020089762a654c65ceca506f8ce0184"
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
