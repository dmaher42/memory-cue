# Memory Cue Windows attention bridge

This folder contains the Windows-only foundation for Memory Cue's taskbar alerts. It is deliberately separate from the existing startup and always-on-top launcher.

Nothing in this folder is installed automatically. Building it does not change Windows, Brave, Memory Cue, the startup shortcut, or the current always-on-top setup.

## What it is for

When the Memory Cue website decides that an appointment needs attention, it sends one of three messages:

- `urgent`: start flashing the Memory Cue taskbar button and apply a persistent red taskbar progress treatment.
- `acknowledged`: stop the current flashing but leave the red treatment in place.
- `clear`: stop flashing and remove the red treatment.

The website remains the source of truth. It decides which appointments are urgent, when later warnings should happen, how many unfinished urgent appointments exist, and when the numbered app badge should clear.

The Windows bridge does not remain running in the background. Brave starts the native host for one message, the host updates the existing Memory Cue window, replies, and exits.

## Important visual limitation

Windows does not provide a supported way to keep the exact flashing red taskbar-button background shown during an attention flash after the window has been clicked. The bridge therefore uses the supported red taskbar progress treatment for the persistent state. The website separately owns the numbered app badge.

## Folder contents

- `host/MemoryCueWindowsAttention.cs` — the one-shot native Windows host.
- `extension/` — a small Brave extension that accepts only validated Memory Cue messages.
- `native-messaging/com.memorycue.windows_attention.json.template` — the registration template that restricts access to one extension ID.
- `scripts/build.ps1` — builds the host and checks the extension files.
- `scripts/install.ps1` — copies and registers the bridge for the current Windows user.
- `scripts/uninstall.ps1` — removes only this bridge's registration and installed files.

## Build without installing

From PowerShell:

```powershell
& .\windows\attention-bridge\scripts\build.ps1
```

The build uses the C# compiler already included with Windows. It runs the host's non-visual self-test, checks both extension scripts, and validates the JSON files. The resulting executable is placed under `artifacts/`, which is ignored by Git.

## Installation outline for a later, approved step

Do not do this merely to test the build. Installation changes the current Brave profile and Windows user registration.

1. In Brave, open `brave://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder's `extension` directory.
4. Copy the extension's 32-letter ID shown by Brave.
5. Run:

```powershell
& .\windows\attention-bridge\scripts\install.ps1 -ExtensionId 'the-id-from-brave'
```

The installer requires no administrator access. It installs the one-shot host under the standard per-user Programs folder at `%LOCALAPPDATA%\Programs\MemoryCue\WindowsAttentionBridge`. It does not touch the current Memory Cue startup shortcut or always-on-top launcher.

The installer registers Brave's own Windows native-messaging location plus the
Chromium and Google Chrome compatibility locations Brave may consult. The
generated manifest still allows only the exact unpacked Memory Cue extension ID.
If an earlier bridge copy exists under `%LOCALAPPDATA%\MemoryCue`, the installer safely migrates the registration to the Programs folder and leaves the old files untouched. The uninstaller recognises and removes either owned location without removing the separate startup/topmost files.

To remove the bridge later:

```powershell
& .\windows\attention-bridge\scripts\uninstall.ps1
```

The Brave extension must also be removed separately from `brave://extensions`.

## Website message contract

Only a page at `https://memory-cue.pages.dev`, `localhost`, or `127.0.0.1` can reach the extension content script. A message must come from the same window and origin and have this exact shape:

```javascript
window.postMessage({
  source: 'memory-cue',
  type: 'memoryCue:windowsAttention',
  action: 'urgent', // or 'acknowledged' or 'clear'
  count: 1,
  stage: '15', // optional
}, window.location.origin);
```

`count` must be a whole number from 0 to 999. `urgent` and `acknowledged` require at least one active appointment; `clear` requires zero.
