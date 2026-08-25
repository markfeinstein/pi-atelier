# Sidebar mouse support research

> Scope: Pi Atelier's docked sidebar. In this note, “widgets” means Atelier
> **sidebar panels** and their disclosure controls, not Pi's separate
> `ctx.ui.setWidget()` editor widgets.
>
> Baseline: Atelier's minimum supported Pi/TUI version is `0.80.7`; current Pi
> documentation and source were also checked at `0.83.0`.

## Executive conclusion

Mouse interaction is feasible without changing Pi or raising Atelier's minimum
Pi version. The right technical seam is the one Atelier already uses for sidebar
resize:

1. keep the sidebar overlay `nonCapturing`,
2. receive SGR mouse frames through `ctx.ui.onTerminalInput`,
3. reuse `parseSgrMouseEvent()`, and
4. hit-test against interaction regions produced by the same layout pass that
   rendered the sidebar.

The first useful action should be **clicking the Tools disclosure row to toggle
active tool names**. It already has `▸`/`▾` affordance and an established state,
command, persistence path, and keyboard/menu fallback. Do not make contributed
panels interactive under the current public panel protocol; it is explicitly
presentation-only.

There is one unavoidable product trade-off: xterm-style mouse reporting is a
terminal-wide mode, not a right-sidebar-only mode. Atelier cannot receive an
ordinary click in the sidebar while simultaneously leaving an unmodified drag
elsewhere to the terminal's native text selection. By the time Atelier sees a
mouse frame, the terminal has already routed that gesture to the application.

Therefore the recommended rollout is:

- **Default:** extend today's temporary Resize mode into a temporary Sidebar
  interaction mode. In that mode, clicks can toggle disclosures and divider
  dragging still resizes. Outside that mode, mouse reporting remains off and
  the README's current text-selection guarantee remains true.
- **Optional follow-up:** offer explicitly opt-in always-on sidebar mouse
  reporting for direct one-click interaction. Document that normal selection
  then requires the terminal's mouse-bypass modifier, commonly Shift and
  terminal-configurable.

## Decision matrix

<!-- markdownlint-disable MD013 -->

| Option | Direct click | Preserves ordinary selection by default | Pi change | Assessment |
| --- | --- | --- | --- | --- |
| Extend temporary Resize mode into Sidebar interaction mode | After one shortcut | Yes | No | **Recommended first** |
| Opt-in reporting while the sidebar is visible | Yes | No; usually Shift-drag is needed | No | Viable opt-in |
| Put `handleInput` on the overlay component | Not by itself | No | No | Wrong routing seam |
| Add a first-class mouse API upstream | Potentially | Still cannot evade terminal-wide reporting | Yes | Not needed for built-ins |

<!-- markdownlint-enable MD013 -->

## What exists today

### The sidebar is deliberately non-capturing

The overlay is anchored top-right, has the live sidebar width, fills the height,
and sets `nonCapturing: true`. Its component implements only `render()` and
`invalidate()`; a test explicitly requires `handleInput` to remain absent so the
editor keeps keyboard focus.

Sources:

- [`src/split-pane.ts:108-120`](../../src/split-pane.ts#L108-L120)
- [`src/sidebar.ts:1086-1105`](../../src/sidebar.ts#L1086-L1105)
- [`tests/sidebar.test.ts:2006-2015`](../../tests/sidebar.test.ts#L2006-L2015)

### Resize mode already implements the low-level mouse path

Atelier already:

- enables xterm button-event tracking (`DECSET 1002`) and SGR encoding
  (`DECSET 1006`),
- parses `CSI < button ; x ; y M/m`,
- receives raw frames through `ctx.ui.onTerminalInput`,
- consumes mouse input while resize mode is active,
- drags from the divider, and
- disables reporting and unsubscribes on completion, cancellation, hide, error,
  and disposal.

Sources:

- [`src/split-pane.ts:4-23`](../../src/split-pane.ts#L4-L23)
- [`src/split-pane.ts:129-142`](../../src/split-pane.ts#L129-L142)
- [`src/split-pane.ts:179-198`](../../src/split-pane.ts#L179-L198)
- [`src/split-pane.ts:249-282`](../../src/split-pane.ts#L249-L282)
- [`src/sidebar.ts:1163-1171`](../../src/sidebar.ts#L1163-L1171)

The README intentionally limits reporting to temporary Resize mode so ordinary
terminal selection is unaffected at other times.

Source: [`README.md:167`](../../README.md#L167)

### Tools already has the best MVP affordance

The Tools status row renders `▸` when active names are hidden and `▾` when they
are shown. The existing setter immediately updates runtime state, patches the
user configuration, and reports persistence failures.

Sources:

- [`src/sidebar.ts:513-529`](../../src/sidebar.ts#L513-L529)
- [`extensions/index.ts:303-325`](../../extensions/index.ts#L303-L325)

At widths below 40 columns, the layout intentionally suppresses expanded tool
names even when the stored preference is true. A mouse target should therefore
be disabled or explain that expansion becomes visible after widening; otherwise
a click can appear to do nothing.

Source: [`src/sidebar.ts:202-213`](../../src/sidebar.ts#L202-L213)

### Rendered row positions are dynamic

The sidebar cannot use hard-coded `y` offsets. It groups adjacent rows into
framed panels, reorders panels from configuration, inserts contributed panels,
and repeatedly drops optional groups until the result fits the terminal height.
A correct hit map must come from the final composed layout, not from panel order,
string matching, or assumed panel heights.

Sources:

- [`src/sidebar.ts:627-665`](../../src/sidebar.ts#L627-L665)
- [`src/sidebar.ts:829-852`](../../src/sidebar.ts#L829-L852)
- [`src/sidebar.ts:1038-1056`](../../src/sidebar.ts#L1038-L1056)

## Verified Pi/TUI API facts

### The minimum supported version already has the needed raw-input seam

Atelier declares Pi and Pi TUI `>=0.80.7`, with `0.80.7` as its development
baseline.

Source: [`package.json:46-56`](../../package.json#L46-L56)

At Pi/TUI `0.80.7`:

- `ExtensionUIContext.onTerminalInput(handler)` is public and returns an
  unsubscribe function;
- interactive mode implements it by calling `TUI.addInputListener()`;
- listeners run before focused-component input and may consume or transform a
  frame; and
- Pi tracks and clears extension listener subscriptions during UI reset.

Primary sources at the `v0.80.7` commit:

- [`ExtensionUIContext.onTerminalInput`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/core/extensions/types.ts#L132-L141)
- [interactive-mode listener wiring and cleanup](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2094-L2110)
- [interactive-mode UI context binding](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2123-L2140)
- [`TUI.addInputListener()` and `removeInputListener()`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L641-L658)
- [listener dispatch before focused-component handling](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L761-L789)

Pi's `StdinBuffer` also recognizes complete SGR mouse sequences and joins frames
that arrive split across stdin chunks. Atelier's parser can therefore remain a
single-frame parser at the supported baseline.

Primary source:
[`packages/tui/src/stdin-buffer.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/stdin-buffer.ts#L80-L127)

The same API remains present in Pi `0.83.0`; its official docs still define
component input as focused raw string input and overlays as focus-managed
components, not as a coordinate-aware click tree.

Primary sources:

- [Pi 0.83.0 TUI component interface](https://github.com/earendil-works/pi/blob/845d6ff1f6643aba440341cce877ce1c43ebbc39/packages/coding-agent/docs/tui.md#component-interface)
- [Pi 0.83.0 overlay documentation](https://github.com/earendil-works/pi/blob/845d6ff1f6643aba440341cce877ce1c43ebbc39/packages/coding-agent/docs/tui.md#overlays)
- [Pi 0.83.0 TUI input-listener dispatch](https://github.com/earendil-works/pi/blob/845d6ff1f6643aba440341cce877ce1c43ebbc39/packages/tui/src/tui.ts#L651-L784)

### Why component `handleInput` is not the answer

`Component.handleInput` exists in both `0.80.7` and `0.83.0`, but Pi calls it on
the **focused component**. Pi does not hit-test a mouse coordinate and dispatch
to the overlay beneath that coordinate. Atelier's overlay is non-capturing so
it intentionally is not focused. Focusing it would route all keyboard input away
from the editor and would still leave Atelier to parse and hit-test raw SGR
frames itself.

Primary sources:

- [Pi 0.80.7 `Component` interface](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L64-L84)
- [Pi 0.80.7 `OverlayOptions.nonCapturing`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L171-L207)
- [Pi 0.80.7 overlay focus decision](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L493-L505)
- [Pi 0.80.7 focused-component input dispatch](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L825-L834)

Keeping mouse routing in the raw listener preserves the current keyboard-focus
contract and avoids a dependency/version split.

## Terminal protocol constraints

The xterm control-sequence specification defines:

- mode `1000`: button press and release,
- mode `1002`: press, release, and motion while a button is held,
- mode `1003`: all motion, and
- mode `1006`: SGR decimal encoding with `M` for press and `m` for release.

It also defines terminal positions from the upper-left cell as `1,1`. Atelier's
existing `1002 + 1006` choice is sufficient for both click/release handling and
divider drag; hover would require `1003` and is not recommended for this scope.

Primary sources:

- [xterm Mouse Tracking](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking)
- [Button-event tracking](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Button-event-tracking)
- [SGR 1006](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-SGR-1006)

### Selection is the hard UX boundary

Mouse reporting is enabled with terminal mode controls; those controls do not
accept a rectangular region. Atelier may ignore an event based on its
coordinates, but it cannot retroactively return that physical gesture to the
terminal's selection engine.

Moreover, while reporting is enabled, **every recognized mouse frame must be
consumed by Atelier**, even when it misses the sidebar. Returning an outside
mouse frame unconsumed would pass the raw `ESC [ < ... M/m` sequence to Pi's
focused editor or another focused component. It would not restore native text
selection and could produce unintended editor input. Pi's listener pipeline
makes this consume/forward behavior explicit.

Primary sources:

- [xterm DECSET mouse modes and Mouse Tracking](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking)
- [Pi 0.80.7 listener dispatch](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L761-L789)

Terminals commonly reserve Shift as an application-mouse bypass, but that is
terminal-specific and configurable. Ghostty, for example, defaults
`mouse-shift-capture` to `false`: Shift is not sent through the application mouse
protocol and instead extends terminal selection. Values `true`, `always`, and
`never` alter whether the application can receive or override Shift behavior.
Atelier can document Shift-drag as the common fallback, but cannot promise it on
every terminal or user configuration.

Primary source:
[Ghostty `mouse-shift-capture`](https://github.com/ghostty-org/ghostty/blob/08342c92446ceda22b49f42ce39e8c4714054a6e/src/config/Config.zig#L944-L977)

## Recommended design

### 1. Generalize the existing temporary mode

Keep `Ctrl+Shift+R` for compatibility, but internally treat it as a Sidebar
interaction session rather than a resize-only session:

- show a short hint such as `SIDEBAR · click controls · drag divider`;
- keep the current arrow, Enter, and Escape resize behavior;
- let primary-button click/release on registered hit regions invoke sidebar
  actions;
- let divider drag keep priority over click actions; and
- leave the mode active after a disclosure click so multiple controls can be
  changed before Enter/Escape.

This reuses the tested `1002 + 1006` lifecycle and preserves native selection
whenever the mode is inactive.

### 2. Produce lines and hit regions together

Introduce a pure render result rather than deriving clicks from text:

```ts
interface SidebarFrame {
  lines: string[];
  hitRegions: readonly SidebarHitRegion[];
}

interface SidebarHitRegion {
  action: SidebarAction;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  enabled: boolean;
}

type SidebarAction =
  | { type: "toggle-tool-names" }
  | { type: "toggle-panel-body"; panelId: string };
```

`renderSidebarLines()` can remain the compatibility wrapper that returns only
`frame.lines`. The sidebar component should publish a frame on every render.
If the main render throws, it must publish an empty hit map before returning the
`Sidebar unavailable` fallback; hide and auto-hide transitions must clear the
map too. Mouse input must use the hit map for the frame actually on screen, never
the previous successful layout.

Build metadata at the `SidebarGroup`/panel composition layer. Do not scan final
ANSI strings for `TOOLS`, `▸`, or panel titles; sanitization, truncation,
reordering, contributions, and height omission make string inference brittle.

### 3. Convert global SGR coordinates to sidebar-local coordinates

For terminal width `T` and the **effective rendered** sidebar width `W`:

```text
sidebarStartX = T - W + 1
localX       = mouse.x - sidebarStartX + 1
localY       = mouse.y
```

All values are 1-based. Use the split-pane controller's effective width and
visibility, not merely the configured width, because the sidebar narrows to
preserve 64 main columns and auto-hides below the minimum terminal width.

The sidebar is top-aligned with zero margin, so global `y` maps directly to the
1-based rendered row. If overlay placement changes later, the hit-test API
should carry an explicit origin rather than preserve this assumption.

Sources:

- [`src/split-pane.ts:102-125`](../../src/split-pane.ts#L102-L125)
- [xterm coordinate origin](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking)

### 4. Use click semantics, not press semantics

Recommended gesture state:

1. on unmodified primary press inside an enabled region, remember its action;
2. on held motion, cancel the pending click if the pointer leaves that region;
3. on release, invoke only if the release resolves to the same action; and
4. clear pending state on cancellation, hide, auto-hide, mode exit, or disposal.

Ignore right/middle/wheel actions for now. Continue consuming their SGR frames
while reporting is active so they do not leak into Pi's editor.

### 5. Keep action ownership above the renderer

The renderer/controller should report `SidebarAction`; it should not directly
mutate configuration or write files. The extension runtime already owns the
canonical Tools mutation and persistence path. Add a controller callback that
reuses `setSidebarToolNames()` so command, menu, and mouse behavior remain
consistent.

Because a mouse can produce rapid repeated clicks, serialize persistence or use
a latest-generation guard. Two asynchronous user-config patches completing out
of order could otherwise leave disk state behind runtime state.

For mouse clicks, consider suppressing the success notification used by the
command/menu path; the disclosure glyph is immediate feedback. Persistence
failures should still notify.

### 6. Keep one mouse-reporting owner

Do not add an independent click subscription beside resize mode. Centralize
mouse reporting, raw subscription, routing priority, and cleanup in one
controller. Separate owners can clobber one another by disabling shared mode
`1006` or unsubscribing while another interaction is active.

The manager must disable reporting when:

- the interaction session ends,
- the sidebar is hidden,
- responsive visibility auto-hides it,
- overlay activation fails,
- the session is replaced or reloaded, or
- the controller is disposed.

It should preserve today's best-effort cleanup behavior if terminal writes,
unsubscription, render requests, or external callbacks throw.

## Scope of clickable behavior

### MVP: Tools disclosure

Make the full Tools status row clickable, not only the one-cell triangle. This
has a clear affordance and a keyboard/menu/command fallback.

In compact mode, either omit the action region or retain it as a preference
change with explicit feedback that names appear only at 40 or more sidebar
columns. Omitting it is less surprising.

### Follow-up: collapse panel bodies, not panel visibility

If “toggle panels” means clicking a panel crown:

- keep the crown visible;
- toggle only the body;
- store a separate `collapsedPanelIds` view state; and
- do not reuse `sidebarPanelLayout.visible`.

Using visibility would remove the very target needed to restore the panel and
would silently rewrite a global layout preference. Session-scoped collapse is
the safer default; persistence can be a separate product decision.

### Contributor panels: remain read-only

The current contribution type is explicitly “structured, presentation-only
data.” Its protocol carries register, unregister, and discover events, but no
action IDs, callbacks, or ownership rules for user gestures.

Sources:

- [`src/sidebar-panels.ts:94-112`](../../src/sidebar-panels.ts#L94-L112)
- [`src/sidebar-panels.ts:118-160`](../../src/sidebar-panels.ts#L118-L160)
- [`README.md:145`](../../README.md#L145)

Do not invent clicks for contributed rows based on their text. Interactive
contributions would require a versioned protocol extension with stable action
IDs, source ownership, event authentication/validation consistent with the
existing registry, lifecycle semantics, and an explicit rule for whether
actions may persist state. That is a separate public-API design.

## Optional always-on mode

Direct one-click behavior without a keyboard pre-step is technically possible:
subscribe and enable `1002 + 1006` while the sidebar is visibly rendered, then
disable both as soon as it hides or auto-hides.

It should be opt-in because:

- no-modifier drag selection stops working while reporting is enabled;
- Atelier must consume mouse frames from the whole terminal, not only the
  sidebar;
- the user's terminal may not reserve Shift for selection; and
- another extension can register an earlier raw-input listener or manipulate the
  same terminal modes.

If added, use a setting whose name makes the trade-off explicit, rather than
silently changing default behavior. Keep `/atelier sidebar tools`, the menu, and
keyboard interaction as complete fallbacks.

## Why an upstream Pi change is not required

Pi already exposes the necessary pre-focus raw-input hook, preserves complete SGR
frames, and gives Atelier the TUI dimensions and terminal writer it currently
uses. A high-level upstream mouse API could improve mode reference-counting,
listener priority, coordinate dispatch, and inter-extension coexistence, but it
would not remove the terminal-wide selection trade-off.

An upstream proposal becomes worthwhile if Atelier wants any of these:

- a shared application-level mouse-mode lease/reference counter;
- input-listener priorities or scoped ownership;
- TUI-managed overlay hit regions;
- cross-extension mouse interoperability; or
- interactive contributed panels as a general Pi ecosystem feature.

None is necessary for the built-in Tools MVP.

## Implementation map

<!-- markdownlint-disable MD013 -->

| Area | Proposed responsibility |
| --- | --- |
| `src/sidebar.ts` | Return a `SidebarFrame`; attach actions to composed rows; store the latest frame; expose action callback(s). |
| `src/split-pane.ts` | Generalize resize input into one mouse interaction router; own reporting, press/drag/release state, coordinate conversion, and cleanup. |
| `extensions/index.ts` | Map `toggle-tool-names` to the existing runtime/persistence mutation; guard session lifecycle and rapid writes. |
| `tests/sidebar.test.ts` | Verify rendered hit regions under ordering, compact mode, height omission, contributions, and errors; verify controller action routing. |
| `tests/split-pane.test.ts` | Verify click/release, drag priority, outside-event consumption, coordinate edges, mode lifecycle, and cleanup failures. |
| `README.md` | Document temporary interaction gestures; document selection trade-off only if an always-on option is added. |

<!-- markdownlint-enable MD013 -->

## Test plan

### Pure layout and hit testing

- Tools hit region tracks the exact rendered row at 28, 39, 40, 44, and 72
  columns.
- Reordered panels and contributed panels move the region correctly.
- Height omission removes regions for omitted rows.
- Error rendering publishes no stale actions.
- Responsive auto-hide produces no actionable sidebar region.
- ANSI color and wide Unicode do not change cell coordinates.

### Mouse routing

- Primary press and same-target release invoke once.
- Press inside/release outside and press outside/release inside do not invoke.
- Motion outside cancels a pending click.
- Divider drag takes priority and never toggles a crossed row.
- Right, middle, wheel, and unsupported modifier combinations do not invoke.
- Every valid mouse frame is consumed while reporting is active, including
  misses outside the sidebar.
- Non-mouse keyboard input keeps today's resize-mode behavior.

### State and lifecycle

- Tool-name clicks reuse runtime state and user persistence.
- Rapid double-click persistence cannot complete out of order.
- Hide, auto-hide, Enter, Escape, overlay close, render failure, session reset,
  and disposal all disable reporting and unsubscribe exactly once.
- An exception while disabling reporting still performs remaining cleanup.
- Existing sidebar non-capturing and editor-input tests continue to pass.

### Manual terminal matrix

At minimum verify Ghostty, Kitty, iTerm2, Apple Terminal, and one tmux session:

- click/release and divider drag;
- Shift-drag text selection while reporting is active;
- ordinary selection after leaving the temporary mode;
- terminal resize across the sidebar auto-hide threshold;
- `/reload`, session switch, normal exit, and interrupted activation; and
- SSH if it is a supported maintainer workflow.

## Risks and mitigations

<!-- markdownlint-disable MD013 -->

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Terminal-global reporting | Native drag selection changes | Keep default interaction temporary; make always-on explicit opt-in. |
| Mouse frames leak to editor | Escape text or unintended input | Consume every recognized frame while reporting is enabled. |
| Dynamic layout drifts from hit testing | Wrong action fires | Generate lines and regions in one pure layout pass. |
| Multiple mouse owners | One mode disables another | Centralize Atelier ownership; consider upstream leases only if ecosystem conflicts become real. |
| Raw listener ordering | Another extension consumes first | Retain keyboard/menu/command fallback; document residual compatibility risk. |
| Rapid async persistence | Disk preference ends stale | Serialize patches or gate completion by generation. |
| Compact/height omission | Click appears ineffective | Mark only currently actionable rendered regions enabled. |
| Contributor action spoofing | Ambiguous or unsafe callbacks | Keep protocol v1 presentation-only; design a versioned declarative protocol separately. |
| Abrupt process death | Terminal mode may remain set until reset | Minimize reporting duration and preserve exhaustive normal cleanup; SIGKILL cannot be handled. |

<!-- markdownlint-enable MD013 -->

## Open product decisions

1. Is a keyboard-activated temporary interaction mode acceptable, or is direct
   one-click behavior important enough to justify an opt-in selection trade-off?
2. Does “toggle panels” mean body collapse, tool-detail disclosure, or changing
   the global visible-panel layout?
3. Should body collapse be session-scoped or saved globally?
4. Should a successful mouse toggle show a notification, or should visual state
   be the only feedback?
5. Is contributor interactivity in scope for a future protocol version?

These choices do not block the Tools MVP. The technical recommendation remains:
**raw input + the existing SGR parser + render-derived hit regions + one
mouse-mode owner**.
