# Pi extension input routing research

> Scope: Pi 0.84 extension/plugin input APIs relevant to Pi Atelier's sidebar.
> Question: can an extension receive selected key or mouse events from Pi without
> globally intercepting all terminal input?

## Summary

Pi currently offers three relevant input mechanisms:

1. **Registered keyboard shortcuts** with `pi.registerShortcut()`.
2. **Focused component input** through `ctx.ui.custom()` / overlay components with
   `Component.handleInput(data)`.
3. **Raw terminal input listeners** through `ctx.ui.onTerminalInput()` /
   `TUI.addInputListener()`.

There is **no first-class extension API for scoped mouse routing** and no API that
subscribes an extension to only a particular key or mouse event while preserving
normal dispatch for everything else, except for the narrow `registerShortcut()`
case. Mouse support requires raw terminal input handling, and in regular TUI mode
also requires enabling terminal mouse reporting globally.

## Findings

### 1. `registerShortcut()` is scoped to a shortcut, but only for keyboard shortcuts

Extensions can register a specific keyboard shortcut:

```ts
pi.registerShortcut("ctrl+shift+p", { handler: async (ctx) => { ... } });
```

Primary sources:

- `docs/extensions.md:1606-1616` documents `pi.registerShortcut(shortcut,
  options)`.
- `dist/core/extensions/types.d.ts:899-904` exposes only a `KeyId` shortcut and
  a handler; there is no mouse equivalent.
- `dist/core/extensions/loader.js:231-233` stores extension shortcuts by key.

However, these shortcuts are installed on the **default editor**, not as a global
TUI-level event subscription. `InteractiveMode.setupExtensionShortcuts()` assigns
`this.defaultEditor.onExtensionShortcut = ...` and checks `matchesKey(data,
shortcutStr)` there.

Primary sources:

- `dist/modes/interactive/interactive-mode.js:1510-1562` sets up extension
  shortcuts on `this.defaultEditor.onExtensionShortcut`.
- `dist/core/extensions/runner.js:1-22` reserves editor-global built-in bindings
  from extension override.
- `dist/core/extensions/runner.js:320-347` resolves extension shortcut conflicts
  against built-ins and other extensions.

Implication for Atelier: a shortcut is appropriate for entering a sidebar mode
(`Ctrl+Shift+R`), but it is not a way to receive arbitrary sidebar clicks or
mouse movement.

### 2. Focused custom components receive keyboard input, but focus captures input

The TUI component contract includes `handleInput?(data)`, described as receiving
keyboard input **when the component has focus**.

Primary sources:

- `docs/tui.md:12-26` documents `Component.render()`, `handleInput()`,
  `wantsKeyRelease`, and `invalidate()`.
- `docs/extensions.md:2698-2724` documents `ctx.ui.custom()` replacing the editor
  with a component and passing `tui`, `theme`, `keybindings`, and `done`.
- `node_modules/@earendil-works/pi-tui/dist/tui.js:612-618` forwards input only to
  `this.focusedComponent?.handleInput`, filtering key releases unless the
  component opts in.

Implication for Atelier: a focused custom component can handle keyboard input,
but focusing the sidebar overlay would take input ownership away from the editor,
which violates the sidebar's non-capturing design.

### 3. Capturing overlays can receive focused input; non-capturing overlays cannot

Overlay handles expose focus/unfocus controls. By default a visible overlay is
focused when shown; `nonCapturing: true` prevents that focus capture.

Primary sources:

- `docs/tui.md:124-177` documents overlays and overlay focus/unfocus behavior.
- `docs/extensions.md:2730-2759` documents overlay mode and `onHandle` focus
  controls.
- `node_modules/@earendil-works/pi-tui/dist/tui.d.ts:100-118` defines
  `OverlayOptions.nonCapturing?: boolean` as “don't capture keyboard focus when
  shown”.
- `node_modules/@earendil-works/pi-tui/dist/tui.js:286-300` shows overlays are
  focused on show only when `!options?.nonCapturing`.
- `node_modules/@earendil-works/pi-tui/dist/tui.js:417-424` shows topmost visible
  overlays skip `nonCapturing` entries.

Implication for Atelier: the current sidebar uses a non-capturing overlay so Pi's
editor keeps focus. That means the sidebar component's own `handleInput()` is not
a viable event path for normal sidebar clicks/keys.

### 4. `ctx.ui.onTerminalInput()` is raw pre-dispatch input interception

The extension UI context exposes `onTerminalInput(handler)`, documented as
listening to raw terminal input and returning an unsubscribe function.

Primary sources:

- `dist/core/extensions/types.d.ts:55-80` defines `TerminalInputHandler` returning
  `{ consume?: boolean; data?: string } | undefined` and documents
  `onTerminalInput()` as raw terminal input.
- `dist/modes/interactive/interactive-mode.js:1790-1807` registers extension
  terminal input subscriptions through `this.ui.addInputListener(handler)` and
  rebinds/clears them across lifecycle changes.
- `dist/modes/interactive/interactive-mode.js:1832` exposes
  `onTerminalInput: (handler) => this.addExtensionTerminalInputListener(handler)`.
- `node_modules/@earendil-works/pi-tui/dist/tui.js:443-450` implements
  `addInputListener()` as a Set of listeners.
- `node_modules/@earendil-works/pi-tui/dist/tui.js:549-568` runs all input
  listeners before focused-component dispatch; each listener may consume the input
  or transform it via `data`.

This is not a scoped subscription. A listener sees the raw terminal input stream
that reaches the TUI and must decide whether to consume, transform, or pass it
through. It is the only public-ish seam that lets a non-capturing overlay observe
input while the editor remains focused.

Implication for Atelier: raw input is the correct current seam for sidebar mouse
hit-testing, but it is also the “hijack all events unless carefully passed
through” seam.

### 5. Fullscreen mode already owns mouse reporting for the viewport

Pi's fullscreen/alt-screen TUI enables mouse reporting and installs a viewport
input listener during construction.

Primary sources:

- `docs/keybindings.md:87-99` documents fullscreen viewport mouse behavior:
  wheel/trackpad scrolling, hyperlink clicks, primary-button drag selection, and
  edge autoscroll.
- `node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js:13-14` defines
  `ENABLE_MOUSE` / `DISABLE_MOUSE` with `1000`, `1002`, `1003`, `1004`, and
  `1006` modes.
- `node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js:67-69` defaults
  `mouseEnabled` to true and adds `handleViewportInput` as an input listener.
- `node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js:114-124` enables
  mouse reporting on terminal start and disables it on stop.
- `node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js:239-293` consumes
  focus, wheel, SGR mouse, and other mouse sequences, and handles fullscreen
  transcript keybindings.
- `node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js:354-366` parses SGR
  mouse frames.

The viewport handler consumes recognized mouse frames after handling scrollbars,
hover, selection, links, or wheel routing.

Implication for Atelier: in fullscreen mode, mouse reporting is already on, but
Atelier must run before Pi's viewport listener if it wants sidebar clicks to win.
Returning unconsumed on sidebar misses should allow Pi's viewport handler to keep
normal fullscreen mouse behavior.

### 6. Regular mode does not provide built-in mouse reporting or routing

The main-screen TUI (`TuiMainScreen`) source has no mouse enable/disable path and
inherits `TuiBase` input dispatch. Mouse reporting is not enabled by regular Pi in
the way fullscreen does.

Primary sources:

- `node_modules/@earendil-works/pi-tui/dist/tui-main-screen.js:1-180` shows the
  regular renderer has no `ENABLE_MOUSE`/mouse listener equivalent in its startup
  code.
- `node_modules/@earendil-works/pi-tui/dist/tui.js:549-568` is the generic raw
  input-listener pre-dispatch path used by regular mode.

Implication for Atelier: direct always-on mouse clicks in regular mode require
Atelier to enable terminal mouse reporting globally. That changes ordinary
terminal text selection behavior, so it should remain explicit opt-in or a
temporary mode.

## Direct answers

### Is there a Pi-supported way for a plugin to get specific key/mouse events without receiving/intercepting all raw input?

- **Specific keyboard shortcut:** yes, `pi.registerShortcut()`, but it is keyboard
  only and installed on the default editor path.
- **Arbitrary keys while visible but not focused:** no first-class scoped API found.
  Use a focused component/overlay, a custom editor wrapper, or raw
  `onTerminalInput()`.
- **Mouse events:** no first-class scoped mouse API found. Use raw terminal input
  and parse terminal mouse frames yourself.

### Can non-capturing overlays receive events?

Not through their component `handleInput()`. Non-capturing overlays do not take
focus, and focused-component dispatch is the component input path. They can only
observe input indirectly with a separate raw `onTerminalInput()` listener.

### Can focused overlays receive events?

Yes. Capturing/focused overlays receive keyboard input through their component's
`handleInput()`, but that captures input from the editor until unfocused or
closed.

### Is there a scoped shortcut API usable here?

Only for a keyboard shortcut like “enter sidebar interaction mode”. There is no
scoped shortcut API for “when this non-capturing overlay is visible, send only
these events to it”, and no mouse shortcut API.

### Is there a mouse routing API?

No first-class extension/component mouse routing API was found. Fullscreen Pi has
an internal viewport mouse handler, but it is not exposed as a general overlay or
component hit-testing API.

## Consequences for Atelier

### Regular mode

Always-on direct sidebar mouse means Atelier must:

1. enable terminal mouse reporting while the sidebar is visible;
2. register a raw input listener;
3. consume valid mouse frames so raw escape sequences do not leak into editor
   input; and
4. document that ordinary terminal selection behavior changes while enabled.

This should not be the default unless the product intentionally accepts that
selection trade-off.

### Fullscreen mode

Direct sidebar mouse is more plausible because Pi already enables mouse
reporting. The safer design is:

1. install/rebind Atelier's raw input listener before the fullscreen viewport
   listener;
2. consume only mouse frames that hit sidebar action regions or the divider;
3. return unconsumed on misses so Pi's viewport listener handles scroll,
   selection, scrollbar dragging, and links; and
4. avoid disabling mouse reporting on exit, because fullscreen Pi owns it.

The current temporary interaction mode is conservative because it uses one path
for both regular and fullscreen and avoids surprising selection changes in
regular mode.

## Unknowns and follow-up checks

- The public API does not expose listener ordering or a mouse lease/reference
  counter. Atelier currently relies on implementation details when reprioritizing
  fullscreen listeners.
- Need manual terminal checks for each terminal/tmux combination before enabling
  any always-on mode.
- A robust upstream improvement would be a Pi-owned mouse router/lease API with
  overlay hit-testing, propagation, and scoped mouse-mode ownership.

## Confidence

High for Pi 0.84 as installed locally. The conclusion is based on Pi's installed
first-party docs and distributed source. Future Pi versions may add higher-level
mouse routing or scoped input APIs.
