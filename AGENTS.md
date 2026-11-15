# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## What this project is

`tabby-clipsnag` is a **Tabby terminal plugin** (Tabby was formerly Terminus). It adds a
hotkey-driven "snag" mode: while active, it captures everything a terminal tab writes to
the screen, strips ANSI control sequences, and copies the cleaned text to the OS clipboard.

- Target host app: **Tabby** (Electron), plugin API packages `tabby-core`, `tabby-terminal`.
- Target Angular generation used by Tabby at time of writing: **Angular 15** (peer range `^15`).
- RxJS: **7.x**.

## Golden rules

1. **Never break the terminal data path.** Output capture must be *passive*: middleware
   may only observe bytes and must always forward them downstream/upstream unchanged.
   A dropped byte corrupts the user's terminal.
2. **Everything is leak-sensitive.** Tabby tabs are long-lived and are opened/closed
   constantly. Every RxJS subscription created per-tab MUST be torn down when the tab is
   destroyed. Use the harness provided by the base classes (`subscribeUntilDetached`,
   `subscribeUntilDestroyed`) rather than manual `subscription.unsubscribe()` calls.
3. **Bound every buffer.** Captured output is user-controlled and can be unbounded
   (e.g. `yes`, a runaway build log). Always enforce `MAX_CAPTURE_BYTES` and flag
   truncation instead of growing without limit.
4. **Strict TypeScript.** `strict: true`, no `any` in our own code, no non-null assertions
   on values that can legitimately be absent, no `@ts-ignore`.
5. **No placeholder code.** Do not commit stubs, TODOs, or "not implemented" throws.

## Architecture at a glance

```
src/
  index.ts               # Angular NgModule + plugin bootstrap (module class)
  config.ts              # ConfigProvider: default settings + hotkey defaults
  hotkeys.ts             # HotkeyProvider: declares hotkey ids
  settings.ts            # SettingsTabProvider + settings UI component
  services/
    clipsnag.service.ts  # Global service: owns the hotkey$ subscription, tab registry,
                         # start/stop orchestration, clipboard write, notifications
  middleware/
    capture.middleware.ts# SessionMiddleware that taps outputToTerminal$ passively
  decorator/
    clipsnag.decorator.ts# TerminalDecorator: attaches a recorder to each terminal tab
```

Plugin settings are editable in the Tabby UI via `ClipsnagSettingsTabProvider`
(`src/settings.ts`); the settings component MUST be listed in the module's
`declarations` (not just `providers`), with `FormsModule` and `TabbyCoreModule`
imported, since Tabby instantiates it through `ComponentFactoryResolver`.

### Why both a decorator *and* middleware?

- **`TerminalDecorator`** gives us a per-terminal lifecycle hook (`attach` / `detach`).
  That is where we bind per-tab state and where cleanup is guaranteed to run.
- **`SessionMiddleware`** is the only supported way to see the raw byte stream that the
  session produces (`outputToTerminal$`). We push one middleware into the tab's
  `session.middleware` stack while recording, and remove it when recording stops or the
  tab closes.

The service (`ClipsnagService`) is the single source of truth for "which tab is being
recorded". Only one recording is active at a time; starting a new one stops the previous.

## Data flow when recording

```
PTY/session --bytes--> session.middleware stack
                          в””в”Ђ CaptureMiddleware.feedFromSession(data)
                                 в”њв”Ђ if recording: push data into the active recorder
                                 в””в”Ђ always: forward to next middleware / terminal
```

The recorder accumulates **bytes** (not decoded strings) so multi-byte UTF-8 sequences
split across chunks are handled correctly; decoding happens once, at stop time.

## Hard invariants (do not regress)

- ANSI stripping happens **once, on stop**, over the whole buffer вЂ” never per chunk
  (per-chunk stripping breaks sequences that straddle chunk boundaries).
- Clipboard is written via `PlatformService.setClipboard`, never via `navigator.clipboard`.
- Recording state is per-tab; switching tabs does not silently stop recording, but
  closing the recorded tab does (and flushes nothing).
- The `MAX_CAPTURE_BYTES` cap is checked before appending; on overflow we keep the
  earliest bytes, drop the rest, and set a `truncated` flag surfaced in the notification.

## Build & test loop

```bash
npm install          # installs dev deps + peer deps (Tabby itself is a peer)
npm run build        # webpack build -> dist/index.js
npm run watch        # incremental rebuild
```

Then load the plugin into Tabby (see `README.md` for the full walkthrough):

```bash
# Linux/macOS
tabby --plugin-dir=/absolute/path/to/tabby-clipsnag
# or copy dist/ + package.json into ~/.config/tabby/plugins/node_modules/tabby-clipsnag
```

On Windows the plugins live under `%APPDATA%\tabby\plugins\node_modules\`.

## Conventions

- File naming follows Tabby's own style: `kebab-case` files, `*.service.ts`,
  `*.decorator.ts`, `*.middleware.ts`.
- Class names are `PascalCase`; a plugin-provided class that is registered with a
  multi-provider is suffixed with the provider base name (e.g. `ClipsnagHotkeyProvider`).
- Keep user-facing strings in English unless a locale file is added.

## Testing checklist before a PR

1. `npm run build` is green with zero TS errors.
2. `npm run lint` (ESLint) is green.
3. Manual: start recording, run `ls --color=always`, stop, paste into a text editor вЂ”
   no `\x1b[...m` escapes remain.
4. Manual: open a second tab during recording, close the recorded tab вЂ” no exception,
   recording state resets, no leaked middleware.
5. Manual: `yes` for a few seconds вЂ” capture truncates at the cap, notification says so.
