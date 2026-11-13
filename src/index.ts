import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'

import {
    HotkeyProvider,
    ConfigProvider,
} from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'

import { ClipsnagConfigProvider } from './config'
import { ClipsnagHotkeyProvider } from './hotkeys'
import { ClipsnagDecorator } from './decorator'
import { ClipsnagService } from './clipsnag.service'

export { ClipsnagService } from './clipsnag.service'
export { ClipsnagDecorator } from './decorator'
export { ClipsnagConfigProvider, ClipsnagConfig, DEFAULT_CLIPSNAG_CONFIG } from './config'
export { ClipsnagHotkeyProvider, CLIPSNAG_TOGGLE_HOTKEY } from './hotkeys'

/**
 * Plugin module.
 *
 * Registration points:
 *  - `HotkeyProvider` (multi) declares the toggle hotkey id so it appears in
 *    Settings → Hotkeys.
 *  - `ConfigProvider` (multi) seeds `config.store.hotkeys['clipsnag-toggle']`
 *    and `config.store.clipsnag`.
 *  - `TerminalDecorator` (multi) attaches the per-tab recording machinery.
 *
 * The module constructor runs once at app start; that is where we subscribe the
 * service to the hotkey stream. `ClipsnagDecorator` is injected by identity so the
 * service talks to the exact instance Tabby registered.
 */
@NgModule({
    imports: [
        CommonModule,
    ],
    providers: [
        { provide: HotkeyProvider, useClass: ClipsnagHotkeyProvider, multi: true },
        { provide: ConfigProvider, useClass: ClipsnagConfigProvider, multi: true },
        { provide: TerminalDecorator, useClass: ClipsnagDecorator, multi: true },
        ClipsnagService,
        ClipsnagDecorator,
    ],
})
export default class ClipsnagModule {
    constructor (
        private readonly service: ClipsnagService,
    ) {
        // Subscribing the service to the hotkey stream is all the eager wiring the
        // plugin needs; everything else is lazy and driven by hotkey presses.
        this.service.init()
    }
}
