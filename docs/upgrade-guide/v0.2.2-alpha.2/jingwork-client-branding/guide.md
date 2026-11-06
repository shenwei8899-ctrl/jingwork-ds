---
kind: upgrade-guide
description: "JingWork packages include their login deployment and use native product identity for welcome and onboarding branding."
---
# JingWork packaged login and product branding

English | [中文](guide.zh.md)

## Change

JingWork desktop login previously required `userData/desktop/jingwork.json`. A fresh installation with isolated data could therefore open the Harness account flow when that file was absent. Native welcome and generic account onboarding also used Harness presentation.

JingWork packages include `resources/jingwork-login.json` for `https://jingwork.openswarm.run`. The native login window opens the deployment's existing login and registration page. A per-installation `desktop/jingwork.json` takes precedence over the packaged defaults. Missing or invalid selected packaged settings and invalid overrides refuse startup.

The installed product identity selects JingWork names, marks, and artwork in native welcome and generic desktop onboarding. The native JingWork account deployment opens the workspace after authorization and skips the generic DeepSeek credit, purpose, and process onboarding flow.

## Migration

1. Replace the installed JingWork application with the rebuilt package for the Mac's processor. Follow the [data-isolation guide](../jingwork-data-isolation/guide.md) when upgrading from a build that shared Harness data.
2. Start JingWork and use the existing JingWork account or the registration link on its login page. Confirm that authorization opens the workspace and that the sidebar displays the JingWork account.
3. For a private deployment, create or update `~/Library/Application Support/JingWork/desktop/jingwork.json` with its HTTPS origin and restart JingWork. The [native account configuration rules](../../../../apps/desktop/README.md#local-desktop-settings) describe accepted origins, timeout values, and failure handling.
4. If startup reports an authentication configuration failure, correct the selected override or reinstall the package containing its default configuration, then restart JingWork.
