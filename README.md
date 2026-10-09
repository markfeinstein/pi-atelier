# Pi Atelier

[![npm version](https://img.shields.io/npm/v/pi-atelier)](https://www.npmjs.com/package/pi-atelier)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/michaelmjhhhh/pi-atelier/blob/main/LICENSE)
[![Pi compatibility: 0.84.0 or newer](https://img.shields.io/badge/Pi-%3E%3D0.84.0-violet)](#requirements)

Keep model, context, version-control status, usage, and tool activity visible while you work in [Pi](https://pi.dev).

Pi Atelier adds a responsive status rail below the composer by default, an optional composer-embedded rail, and a live activity sidebar to your terminal.

[Quick start](#quick-start) · [Features](#features) · [Use](#use) · [Configuration](#configuration) · [Troubleshooting](#troubleshooting)

[![Pi Atelier status rail and activity sidebar demo](https://raw.githubusercontent.com/michaelmjhhhh/pi-atelier/main/assets/demo.png?v=0.10.0)](https://github.com/michaelmjhhhh/pi-atelier/releases/download/v0.10.0/demo.mp4)

[Watch the demo (v0.10.0)](https://github.com/michaelmjhhhh/pi-atelier/releases/download/v0.10.0/demo.mp4)

## Quick start

Install the extension:

```bash
pi install npm:pi-atelier
```

Atelier uses the core packages supplied by the running Pi host. Its npm peers are optional to prevent
installing a second copy of Pi; Pi itself is still required and must be updated separately.

Start Pi, then open the control center:

```text
/atelier
```

You can also press **Alt+A** on macOS and Windows. If icons appear as boxes, select **Settings → Font mode → Plain text**. For icon setup, see [Terminal font](#terminal-font).

Pi packages run with your system permissions. Review third-party source before installation.

### Requirements

- Pi 0.84.0 or newer
- Node.js 22.19.0 or newer
- Interactive TUI mode
- A monospace terminal font; use Plain text mode or select a Nerd Font for icons

### Terminal font

Plain text mode works with a standard monospace font and preserves colors, metrics, and responsive layout. The default Nerd Font mode requires a Nerd Font selected in your terminal settings.

See the [font setup guide and Plain text preview](https://github.com/michaelmjhhhh/pi-atelier/blob/main/docs/usage.md#terminal-font) for installation instructions and configuration details.

## Features

- **Subagent costs:** colored per-child cost curves from pi-subagents accounting events, with matching legends and real observation markers. Open `/atelier` → **Subagent usage** (or `/atelier usage`) for a framed, larger graph, keyboard focus and individual reply costs. Kitty-compatible terminals display smooth native graphics; other terminals use text strokes.
- **Session visibility:** model, thinking level, context, token usage, cost, and session details in a compact status rail and sidebar.
- **Live activity:** agent, tool, and subagent lifecycle activity, including queued, running, detached, paused, attention, timeout, completion, and failure states.
- **Workspace context:** a compact project-titled panel with workspace identity, read-only Git status, or Jujutsu workspace and last-snapshotted status; Agent model and activity remain independently configurable.
- **Personalization:** display presets, configurable segments and panels, working labels, selectable or custom color schemes, optional Nerd Font icons, and model and tool controls.

No telemetry or external network requests. See [Privacy](#privacy).

## Use

Open `/atelier` or press **Alt+A** to change display settings, control the sidebar, select models and tools, rename the session, or compact it.

```text
/atelier display            # display settings
/atelier sidebar            # toggle sidebar
/atelier sidebar on|off     # set sidebar visibility
/atelier sidebar tools      # toggle tool names
/atelier enable|disable     # set extension state
```

The sidebar starts visible and hides when the terminal is too narrow. Click any visible widget frame to collapse or expand its body; collapsed widgets retain their primary summary row in a compact frame, and the Tools disclosure row still toggles tool names. Press `Ctrl+Shift+R` to resize the sidebar by mouse or keyboard. In regular terminal mode, Atelier enables mouse reporting while the sidebar is visible, so use the terminal's mouse-bypass modifier—typically Shift—for native text selection. Fullscreen mouse events outside actionable Sidebar regions continue to Pi's viewport. The TODO panel supports Pi `todo` results and the optional `@juicesharp/rpiv-todo` extension.

The Subagents panel combines the existing cost view with live `pi-subagents` lifecycle activity. It restores current-session async results after reload and keeps terminal runs in the recent list for ten minutes.

Choose a status rail preset in the display settings:

| Preset | Layout |
| --- | --- |
| **editorial** | Default layout |
| **minimal** | Compact layout |
| **classic** | Detailed telemetry |

Pi supports one custom footer and one custom editor at a time. Extension load order determines which chrome is visible.

See the [usage guide](https://github.com/michaelmjhhhh/pi-atelier/blob/main/docs/usage.md) for responsive layout, selection and copy, inline images, and disable/re-enable behavior.

## Configuration

User configuration:

```text
~/.pi/agent/pi-atelier.json
```

Trusted project configuration:

```text
<project>/.pi/pi-atelier.json
```

Project settings override user settings. Session changes override both. Global font mode, sidebar startup, and notification preferences remain user-only.

```json
{
  "preset": "editorial",
  "nerdFont": true,
  "shortcut": "alt+a",
  "density": "comfortable",
  "contextWarning": 70,
  "contextDanger": 90,
  "showSidebarOnStartup": true,
  "showSidebarToolNames": false,
  "completionNotifications": true,
  "statusRailPlacement": "footer",
  "workingLabels": ["THINKING", "WORKING", "PROCESSING"],
  "colorScheme": "atelier"
}
```

Use **Settings → Display** to reorder or hide status rail segments and sidebar panels. Rich contributed panels can also expose compact and expanded presentations; select one and press **C** to change its persisted global-user state, then save. Unavailable contributed panel IDs remain listed so their saved order and visibility can be maintained. Undo restores the latest Display or Sidebar edit, including collapse state and a Display Revert. Legacy user settings `showSidebarAgent` and `showSidebarTodos` remain supported when `sidebarPanelLayout` is absent.

`statusRailPlacement` controls where the rail appears. The default, `"footer"`, keeps Atelier's rounded editor and renders the complete rail below the composer with quiet dot-separated identity items and compact right-aligned telemetry; Nerd Font item icons remain available. Set it to `"composer"` to embed identity and context in the composer's top border and leave measured telemetry below it. Composer mode automatically falls back to its complete grouped footer when the header is unavailable or the terminal is too narrow or short.

`workingLabels` controls the working-state phrase. Omit it for the built-in phrase set, set it to `false` for a static `WORKING` label, or provide a non-empty string array. One phrase is selected per work cycle and remains stable until that cycle ends.

`colorScheme` accepts `"atelier"`, `"inherit"`, or a custom role map. Custom maps may set `base` to either named scheme and override roles such as `accent`, `working`, `input`, `output`, `cache`, `cost`, `context`, `warning`, `error`, `chartPink`, and `chartGreen`. Values may be Pi theme tokens, `#RRGGBB`, xterm indices from 0 to 255, or an empty string for the terminal default. Custom objects layer role by role across user, trusted-project, and session configuration.

Extension statuses are sanitized before rendering, including CSI, OSC, C1, and single-character terminal escape sequences. A non-empty `NO_COLOR` value makes Atelier-authored foreground painting plain text, including the composer frame, menus, Settings, usage overlays, and contributed literal colors, while preserving host-owned editor content; leaving `NO_COLOR` unset or empty preserves color.

### Contributed sidebar panels

Extensions can publish presentation-only panels over Pi's local event bus with `registerSidebarPanel`. Protocol-v1 `rows` remain mandatory and work unchanged. Producers may additionally provide flat rich nodes for text, spans, key/value rows, headings, bars, progress, and spacing, with optional compact content. Atelier applies shared aggregate budgets across expanded and compact content, including nested items, raw input, and sanitized output; strips terminal control sequences; accepts literal colors only as `#RRGGBB`; and rejects malformed roles, colors, numbers, optional fields, or non-finite values. Rich content has no callbacks, actions, arbitrary ANSI, or nesting, and invalid rich data falls back wholly to legacy rows.

Contributed panels do not add network access. Producers may publish `{ available: false, reason }`; the bounded, sanitized descriptor remains identifiable in Settings while registered but does not render, and disappears on unregister. Mouse panel interactions remain available only during Sidebar Resize mode.

## Troubleshooting

- Shortcut unavailable: use `/atelier`, change `shortcut`, then run `/reload`. The default is `alt+a` on macOS and Windows. Other custom `shortcut` settings add an alternative binding alongside Alt+A. Other extensions or terminal key mappings can still intercept Alt+A.
- Status rail missing: use TUI mode and check for another custom footer.
- Missing icon glyphs: choose **Settings → Font mode: Plain text**, or select a Nerd Font in your terminal settings.
- Metric mismatch: token and cost totals cover the session; context usage covers the current model context.

## Privacy

Pi Atelier:

- Does not collect telemetry or analytics
- Does not store prompts, responses, or credentials
- For subagent usage, reads local metadata and owner-validated diagnostic event logs; retains only numeric cost/time projections in memory and saves only run IDs and artifact paths in the Pi session. Prompt/reply content in those logs is discarded. Active background runs refresh until they settle
- Uses read-only Git or Jujutsu inspection for workspace status only after the project is trusted; Jujutsu reads use `--ignore-working-copy`, report the last state Jujutsu snapshotted, and never snapshot or mutate the repository
- Does not read untracked file contents
- Reads project configuration only for trusted projects
- Does not include prompts or responses in notifications
- Accepts contributed sidebar presentation data only through Pi's local event bus; contributors receive no Atelier network or credential access

## Development

```bash
git clone https://github.com/michaelmjhhhh/pi-atelier.git
cd pi-atelier
npm ci
npm run check
./node_modules/.bin/pi --no-session --no-extensions -e ./extensions/index.ts
```

See [CONTRIBUTING.md](https://github.com/michaelmjhhhh/pi-atelier/blob/main/CONTRIBUTING.md).

The command above opens a temporary session with only the checkout's extension loaded, avoiding conflicts with an installed copy.

`npm run check` includes a dependency audit and a clean install of the packed extension, so it requires
npm registry access. The install check verifies that Atelier adds no runtime dependencies and loads
through the development Pi host. Run `npm run check:audit` or `npm run check:install` separately to
investigate dependency warnings. Warnings from an existing Pi installation can also come from the
host or other installed packages; Atelier's checks cover its own dependency trees.

Development stays on Pi 0.84.0 to check the minimum supported API. A scoped npm override patches
that host's pinned `undici` dependency to 8.10.2. Remove the override when the development baseline
moves to a compatible Pi release with patched `undici`. Root overrides do not apply to consumers
or update their Pi hosts.

## License

[MIT](https://github.com/michaelmjhhhh/pi-atelier/blob/main/LICENSE)
