---
description: "Build and publish unsigned JingWork Windows x64 installers with background downloads and user-confirmed restart installation."
---

# Windows internal updates

English | [中文](README.zh.md)

## Summary

Internal distribution uses unsigned Windows x64 installers without purchasing or deploying code-signing certificates. Installed applications download available updates in the background and retain a restart action. Installation requires user confirmation and normal task shutdown. This explicit JingWork mode is separate from signed releases and offline development builds.

## Table of Contents

- [Build and publish](#build-and-publish)
- [Installation and trust](#installation-and-trust)
- [Verification](#verification)

## Build and publish

Use a Windows x64 machine with the [packaging toolchain](../packaging/README.md). Set these public values in `apps/desktop/.env.windows`, replacing the example origin with the enterprise download service:

```dotenv
DSH_DESKTOP_APP_ID=com.jingwork.desktop
DSH_DESKTOP_PRODUCT=jingwork
DSH_DESKTOP_AUTO_UPDATE_ENV=production
DOWNLOAD_PROD_ORIGIN=https://updates.example.com
```

The existing `test` deployment and machine presets also work; test requires `DOWNLOAD_TEST_ORIGIN` and `DOWNLOAD_TEST_RELEASE_ID`. Internal packaging does not load preset signing credentials. Select this mode through the command, not an inherited environment variable:

```sh
pnpm --dir apps/desktop run package:win:x64:internal --build-version auto
```

The target writes `*-internal.exe`, its blockmap, channel YAML and a completion record under `.desktop-build/targets/win-x64/internal-artifacts/`. Packaging or assembled-runtime failure prevents completion. `--unsigned` remains offline development mode and cannot be combined with `--internal-update`.

Configure the existing [publication credentials](../publishing/README.md), then publish the update feed and bootstrap installer:

```sh
pnpm --dir apps/desktop run upload:win:x64:internal
pnpm --dir apps/desktop run upload:latest:win:x64:internal
```

Production uses `jingwork/internal/feeds/win-x64/` and `jingwork/internal/bin/win-x64/`; stable binaries add `/stable`. Test objects add the release ID below `jingwork/`. The bootstrap URL is `/desktop/jingwork-internal-latest-windows-x64.exe`. The HTTPS service must serve these paths. Uploads validate completion, mode, version, destination, size and SHA-512, then send binaries and blockmaps before YAML. Internal uploads do not create signed release tags.

## Installation and trust

Install the internal bootstrap once on each employee computer. Older offline installers and signed installers that expect a publisher certificate need this manual transition. Subsequent builds require a greater semantic version and the same deployment and channel.

The installed manifest authorizes background downloads; downloaded metadata and process environment cannot enable them in an existing signed package. The update indicator shows progress and then **Install and restart**. Closing the app never installs an update. Download failures require explicit retry. Channel changes retire the old target before preparing another.

HTTPS protects delivery; SHA-512 compares downloaded bytes with the feed. Neither authenticates a Windows publisher nor independently protects against a compromised update server. Restrict publication credentials and server write access. Windows warnings and enterprise application-control rules still apply. macOS signing and notarization remain separate.

## Verification

Focused tests cover mode isolation, HTTPS requirements, builder metadata, packaging failures, upload validation, background downloads and explicit installation. Windows release operators must install two successive internal builds, confirm background download and restart, then verify the resulting version and retained user data. A macOS build or intercepted installer handoff does not establish this Windows installation result.

## Dev Note

None.
