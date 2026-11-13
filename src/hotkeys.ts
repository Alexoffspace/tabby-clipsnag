import { HotkeyProvider, HotkeyDescription } from 'tabby-core'

/** Single toggle hotkey: first press arms capture, the next press stops and copies. */
export const CLIPSNAG_TOGGLE_HOTKEY = 'clipsnag-toggle'

export class ClipsnagHotkeyProvider extends HotkeyProvider {
    async provide (): Promise<HotkeyDescription[]> {
        return [
            {
                id: CLIPSNAG_TOGGLE_HOTKEY,
                name: 'Toggle terminal output snagging',
            },
        ]
    }
}
