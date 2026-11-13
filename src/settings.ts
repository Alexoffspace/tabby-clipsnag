import { Component, ViewEncapsulation } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'

import { ClipsnagConfig, DEFAULT_CLIPSNAG_CONFIG } from './config'

/** Bytes per mebibyte, used to present `maxCaptureBytes` as a friendly MiB number. */
const MIB = 1024 * 1024

/**
 * Settings UI for the Clipsnag plugin.
 *
 * Binds two-way to `config.store.clipsnag`; every change persists immediately
 * through `ConfigService.save()`, mirroring the behaviour of Tabby's own tabs.
 */
@Component({
    selector: 'clipsnag-settings-tab',
    // Tabby's layout classes (form-line/header/title/description) are defined
    // globally, not per-component. With the default emulated encapsulation the
    // component's own view receives [_ngcontent-*] scoping attributes that the
    // global selectors don't match, so the rows collapse into an unaligned
    // layout. Disabling encapsulation restores Tabby's native settings look.
    encapsulation: ViewEncapsulation.None,
    template: `
        <h3 class="mb-3">Clipsnag</h3>

        <div class="content-box">
            <div class="form-line">
                <div class="header">
                    <div class="title">Capture buffer limit (MiB)</div>
                    <div class="description">Maximum amount of output kept per recording; older bytes are dropped past this size</div>
                </div>
                <input
                    class="form-control"
                    type="number"
                    min="0.1"
                    step="0.1"
                    [ngModel]="maxCaptureMiB"
                    (ngModelChange)="setMaxCaptureMiB($event)"
                >
            </div>

            <div class="form-line">
                <div class="header">
                    <div class="title">Stop after idle (seconds)</div>
                    <div class="description">Recording stops automatically after this much silence; set to 0 to disable</div>
                </div>
                <input
                    class="form-control"
                    type="number"
                    min="0"
                    step="1"
                    [ngModel]="autoStopSeconds"
                    (ngModelChange)="setAutoStopSeconds($event)"
                >
            </div>

            <div class="form-line">
                <div class="header">
                    <div class="title">Copy to clipboard on stop</div>
                    <div class="description">Write the ANSI-stripped capture to the system clipboard when recording ends</div>
                </div>
                <toggle [ngModel]="settings().copyToClipboardOnStop" (ngModelChange)="setCopyToClipboard($event)"></toggle>
            </div>

            <div class="form-line">
                <div class="header">
                    <div class="title">Stop on tab switch</div>
                    <div class="description">Finish and copy the capture as soon as you switch away from the recorded tab</div>
                </div>
                <toggle [ngModel]="settings().stopOnTabSwitch" (ngModelChange)="setStopOnTabSwitch($event)"></toggle>
            </div>
        </div>
    `,
})
export class ClipsnagSettingsTabComponent {
    constructor (
        public readonly config: ConfigService,
    ) {
        this.ensureSettings()
    }

    /** MiB as shown in the number input. */
    get maxCaptureMiB (): number {
        return roundTo((this.settings().maxCaptureBytes ?? DEFAULT_CLIPSNAG_CONFIG.maxCaptureBytes) / MIB, 2)
    }

    /** Seconds as shown in the number input. */
    get autoStopSeconds (): number {
        return roundTo((this.settings().autoStopAfterIdleMs ?? DEFAULT_CLIPSNAG_CONFIG.autoStopAfterIdleMs) / 1000, 2)
    }

    setMaxCaptureMiB (value: number | string): void {
        const mib = Number(value)
        const bytes = Number.isFinite(mib) && mib > 0
            ? Math.round(mib * MIB)
            : DEFAULT_CLIPSNAG_CONFIG.maxCaptureBytes
        this.settings().maxCaptureBytes = bytes
        this.save()
    }

    setAutoStopSeconds (value: number | string): void {
        const seconds = Number(value)
        const ms = Number.isFinite(seconds) && seconds >= 0
            ? Math.round(seconds * 1000)
            : DEFAULT_CLIPSNAG_CONFIG.autoStopAfterIdleMs
        this.settings().autoStopAfterIdleMs = ms
        this.save()
    }

    setCopyToClipboard (value: boolean): void {
        this.settings().copyToClipboardOnStop = value
        this.save()
    }

    setStopOnTabSwitch (value: boolean): void {
        this.settings().stopOnTabSwitch = value
        this.save()
    }

    /**
     * `config.store.clipsnag` is seeded by the config provider, but the settings
     * component is also reachable before the store is merged (e.g. during a
     * config-file reload). Materialize the section so nested bindings never read
     * through `undefined`.
     */
    private ensureSettings (): void {
        const store = this.config.store as { clipsnag?: Partial<ClipsnagConfig> }
        if (!store.clipsnag || typeof store.clipsnag !== 'object') {
            store.clipsnag = { ...DEFAULT_CLIPSNAG_CONFIG }
        }
    }

    /** Config view used by the template; never yields `undefined` fields. */
    settings (): Partial<ClipsnagConfig> {
        this.ensureSettings()
        return (this.config.store as { clipsnag: Partial<ClipsnagConfig> }).clipsnag
    }

    private save (): void {
        void this.config.save()
    }
}

/** Registers the Clipsnag section in Tabby's settings window. */
export class ClipsnagSettingsTabProvider extends SettingsTabProvider {
    id = 'clipsnag'
    icon = 'clipboard'
    title = 'Clipsnag'
    weight = 10

    getComponentType (): unknown {
        return ClipsnagSettingsTabComponent
    }
}

function roundTo (value: number, digits: number): number {
    const factor = 10 ** digits
    return Math.round(value * factor) / factor
}
