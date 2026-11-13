import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'

import TabbyCoreModule, {
    HotkeyProvider,
    ConfigProvider,
} from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'
import { SettingsTabProvider } from 'tabby-settings'

import { ClipsnagConfigProvider } from './config'
import { ClipsnagHotkeyProvider } from './hotkeys'
import { ClipsnagDecorator } from './decorator'
import { ClipsnagService } from './clipsnag.service'
import { ClipsnagSettingsTabComponent, ClipsnagSettingsTabProvider } from './settings'

export { ClipsnagService } from './clipsnag.service'
export { ClipsnagDecorator } from './decorator'
export { ClipsnagConfigProvider, ClipsnagConfig, DEFAULT_CLIPSNAG_CONFIG } from './config'
export { ClipsnagHotkeyProvider, CLIPSNAG_TOGGLE_HOTKEY } from './hotkeys'
export { ClipsnagSettingsTabComponent, ClipsnagSettingsTabProvider } from './settings'

/**
 * Plugin module.
 *
 * Registration points:
 *  - `HotkeyProvider` (multi) declares the toggle hotkey id so it appears in
 *    Settings → Hotkeys.
 *  - `ConfigProvider` (multi) seeds `config.store.hotkeys['clipsnag-toggle']`
 *    and `config.store.clipsnag`.
 *  - `TerminalDecorator` (multi) attaches the per-tab recording machinery.
 *  - `SettingsTabProvider` (multi) adds the "Clipsnag" section to Settings.
 *
 * The settings component must be declared here (not just provided) because Tabby
 * instantiates it through `ComponentFactoryResolver`, which resolves directives
 * and pipes from the declaring module's scope. `TabbyCoreModule` is imported so
 * the component can use core building blocks such as `<toggle>`.
 *
 * The module constructor runs once at app start; that is where we subscribe the
 * service to the hotkey stream. `ClipsnagDecorator` is injected by identity so the
 * service talks to the exact instance Tabby registered.
 */
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        TabbyCoreModule,
    ],
    declarations: [
        ClipsnagSettingsTabComponent,
    ],
    providers: [
        { provide: HotkeyProvider, useClass: ClipsnagHotkeyProvider, multi: true },
        { provide: ConfigProvider, useClass: ClipsnagConfigProvider, multi: true },
        { provide: TerminalDecorator, useClass: ClipsnagDecorator, multi: true },
        { provide: SettingsTabProvider, useClass: ClipsnagSettingsTabProvider, multi: true },
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
