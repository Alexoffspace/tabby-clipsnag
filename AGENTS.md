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
  services/
    clipsnag.service.ts  # Global service: owns the hotkey$ subscription, tab registry,
                         # start/stop orchestration, clipboard write, notifications
  middleware/
    capture.middleware.ts# SessionMiddleware that taps outputToTerminal$ passively
  decorator/
    clipsnag.decorator.ts# TerminalDecorator: attaches a recorder to each terminal tab
```

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
                          └─ CaptureMiddleware.feedFromSession(data)
                                 ├─ if recording: push data into the active recorder
                                 └─ always: forward to next middleware / terminal
```

The recorder accumulates **bytes** (not decoded strings) so multi-byte UTF-8 sequences
split across chunks are handled correctly; decoding happens once, at stop time.

## Hard invariants (do not regress)

- ANSI stripping happens **once, on stop**, over the whole buffer — never per chunk
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
3. Manual: start recording, run `ls --color=always`, stop, paste into a text editor —
   no `\x1b[...m` escapes remain.
4. Manual: open a second tab during recording, close the recorded tab — no exception,
   recording state resets, no leaked middleware.
5. Manual: `yes` for a few seconds — capture truncates at the cap, notification says so.


# SYSTEM ROLE & OPERATIONAL RULES

### 1. Pre-Execution Root-Cause Analysis
Before making any edits or writing code, you MUST output a concise multi-step technical analysis using this exact structure:
[ANALYSIS]
- Root Issue: [True underlying cause, not just the symptom]
- Side-Effects: [Potential breaking changes in related systems/configs]
- Edge Cases: [At least 2 hidden edge cases or fail-states]
- Strategy: [Step-by-step logic of the proposed structural fix]

Never skip this block. Complete the analysis before calling file-editing tools or outputting code. Keep each point strictly factual and telegraphic to save tokens.

### 2. Token Economy & Language Rules
- **Strict Token Economy:** Maximize token efficiency. Output ONLY what is directly relevant to the task. Zero conversational filler, pleasantries, meta-commentary, or summaries of what was changed. Every word must carry technical payload.
- **Language Match:** Always communicate, fill out the `[ANALYSIS]` block, and write status updates in the exact language used by the user in their prompt.
- **Code Comments:** All inline comments and docstrings inside the code MUST be written strictly in English, regardless of the chat language.
- **Completion Trigger:** After successful execution, output only a single word equivalent to "Done." or "Fixed." in the user's language (e.g., "Готово." / "Исправлено.").

### 3. Code Editing & Display Hygiene
- **File Editing:** Use your native editing/diff tools freely in whatever way is most efficient and reliable to apply changes to the codebase.
- **Chat Code Output:** Do not echo modified code into the chat after editing files. ONLY display code in the chat if the user explicitly asks to see it — and when asked, output only the relevant snippets or target functions wrapped in markdown code blocks, never the full file.

### 4. Agent Memory Upkeep (AGENTS.md)
- If a systemic architectural rule, project convention, or operational constraint is established or modified during the session, append exactly one concise line to `AGENTS.md`. Do not touch other configuration files unless explicitly required by the task.

### 5. Stuck Loop & Expert Handoff
- If an issue remains unresolved after 2 distinct attempts, stop retrying immediately.
- Output the equivalent of "Prompt for expert AI:" in the user's language, followed by a single markdown code block containing a compact, self-contained prompt (context, current code, failed attempts, and desired outcome).