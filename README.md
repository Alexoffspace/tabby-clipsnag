# tabby-clipsnag

A [Tabby](https://tabby.sh) terminal plugin. Press a hotkey, let a noisy command run,
press it again — the plugin strips the ANSI control garbage and drops clean text on your
clipboard.

Think of it as "select all the output of the last command", but driven by the actual byte
stream (colors, cursor moves, TUI redraws and all) instead of the terminal's scrollback,
and it works the same whether the output scrolled off screen or not.

## Features

- **One toggle hotkey** (default `Ctrl-Shift-X`, `⌘-Shift-X` on macOS) to start and stop.
- **Passive capture** — installs a `SessionMiddleware` that observes bytes and forwards
  them unchanged; your terminal renders exactly as before while recording.
- **Correct ANSI stripping** — the whole capture is decoded and stripped once on stop, so
  colour codes, cursor movement, OSC titles, and hyperlinks never leak into the clipboard.
- **Bounded memory** — capture stops growing at a configurable cap (default **5 MB**),
  keeping the earliest bytes and reporting truncation in the notification.
- **Auto-stop on idle** — optionally stop by itself after N ms of silence (default 3000 ms).
- **Leak-safe** — everything is torn down with the tab; closing a recorded tab cancels the
  recording cleanly with no dangling subscriptions.

## Configuration

All settings live under the `clipsnag` key in `~/.config/tabby/config.yaml`
(`%APPDATA%\tabby\config.yaml` on Windows):

```yaml
hotkeys:
  clipsnag-toggle: Ctrl-Shift-X

clipsnag:
  maxCaptureBytes: 5242880        # 5 MB hard cap; older bytes kept, rest discarded
  autoStopAfterIdleMs: 3000       # stop after 3s of silence; 0 disables auto-stop
  copyToClipboardOnStop: true     # write the cleaned text to the OS clipboard
  stopOnTabSwitch: false          # reserved
```

The hotkey can also be changed in **Settings → Hotkeys → Toggle terminal output snagging**.

## How it works

```
hotkey ──▶ ClipsnagService.toggle()
              │
              ├─ start: resolve active terminal tab
              │          └─ TerminalDecorator.startRecording(tab, sink)
              │                └─ CaptureMiddleware pushed into session.middleware
              │                     └─ feedFromSession() copies bytes into CaptureBuffer
              │
              └─ stop:  CaptureBuffer.finish()
                           ├─ Buffer.concat + utf8 decode
                           ├─ stripAnsi(...)
                           └─ PlatformService.setClipboard({ text })
```

- `TerminalDecorator` supplies the per-tab lifecycle hook and guarantees cleanup with
  `subscribeUntilDestroyed`.
- `SessionMiddleware` is the only supported way to see the raw session byte stream.
- The service owns the single active recording and subscribes to the toggle hotkey once.

Because bytes are accumulated (not decoded per chunk), multi-byte UTF-8 characters split
across PTY chunks survive intact, and ANSI sequences that straddle chunk boundaries are
stripped correctly.

## Building

Requires Node 18+.

```bash
npm install
npm run build      # -> dist/index.js (+ .d.ts)
npm run watch      # incremental rebuild while developing
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

## Installing into Tabby for testing

Pick whichever is convenient:

### Option A — point Tabby at the folder (fastest for dev)

```bash
# Linux / macOS
tabby --plugin-dir=/absolute/path/to/tabby-clipsnag

# Windows (PowerShell)
tabby --plugin-dir=C:\Users\you\github\alexoffspace\tabby-clipsnag
```

`--plugin-dir` must point at the project root (the folder containing `package.json` and
`dist/`). Run `npm run build` first.

### Option B — drop it into the plugins directory

Copy `package.json` and the whole `dist/` folder into the per-user plugin directory:

```
Linux:   ~/.config/tabby/plugins/node_modules/tabby-clipsnag/
macOS:   ~/Library/Application Support/tabby/plugins/node_modules/tabby-clipsnag/
Windows: %APPDATA%\tabby\plugins\node_modules\tabby-clipsnag\
```

Then restart Tabby.

### Verifying it loaded

Open **Settings → Plugins** — `tabby-clipsnag` should be listed. Then:

1. Focus a terminal tab and run `ls --color=always`.
2. Press `Ctrl-Shift-X` — a toast says *recording …*.
3. Press `Ctrl-Shift-X` again — a second toast reports the size; paste anywhere.

The first press arms capture, the second stops it. With `autoStopAfterIdleMs > 0` you can
also just wait: recording ends automatically once output goes quiet.

## License

MIT
