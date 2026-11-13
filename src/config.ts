import { ConfigProvider, Platform } from 'tabby-core'

/**
 * Settings shape exposed under `config.store.clipsnag`.
 * Declared explicitly (rather than left as `any`) so the service reads typed values.
 */
export interface ClipsnagConfig {
    /** Hard cap on captured bytes before truncation kicks in. */
    maxCaptureBytes: number
    /**
     * Automatically stop recording after this many milliseconds of silence.
     * `0` disables auto-stop (recording then ends only on a second hotkey press).
     */
    autoStopAfterIdleMs: number
    /** Copy the cleaned capture to the system clipboard when recording stops. */
    copyToClipboardOnStop: boolean
    /** Reserved: tear down capture when the user switches away from the tab. */
    stopOnTabSwitch: boolean
}

/**
 * Single source of truth for default settings. Used both by the config provider
 * (to seed `config.store`) and by the service (as a per-field validation fallback
 * against malformed user config).
 */
export const DEFAULT_CLIPSNAG_CONFIG: ClipsnagConfig = {
    maxCaptureBytes: 5 * 1024 * 1024,
    autoStopAfterIdleMs: 3000,
    copyToClipboardOnStop: true,
    stopOnTabSwitch: false,
}

export class ClipsnagConfigProvider extends ConfigProvider {
    defaults = {
        // Hotkey ids must match those returned by ClipsnagHotkeyProvider.
        hotkeys: {
            'clipsnag-toggle': ['Ctrl-Shift-X'],
        },
        clipsnag: DEFAULT_CLIPSNAG_CONFIG,
    }

    platformDefaults = {
        // Cmd is the idiomatic modifier on macOS; avoid clobbering the OS Ctrl-Shift-X.
        [Platform.macOS]: {
            hotkeys: {
                'clipsnag-toggle': ['⌘-Shift-X'],
            },
        },
    }
}
