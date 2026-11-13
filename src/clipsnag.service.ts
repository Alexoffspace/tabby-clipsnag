import { Injectable, NgZone } from '@angular/core'
import { Subscription, timer, Subject } from 'rxjs'
import { takeUntil } from 'rxjs/operators'
import {
    AppService,
    ConfigService,
    HotkeysService,
    NotificationsService,
    PlatformService,
    SplitTabComponent,
} from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'

import { CLIPSNAG_TOGGLE_HOTKEY } from './hotkeys'
import { ClipsnagConfig, DEFAULT_CLIPSNAG_CONFIG } from './config'
import { CaptureBuffer } from './capture-buffer'
import { ClipsnagDecorator, TabRecorder } from './decorator'

/** Everything tied to the one in-flight recording. */
interface ActiveRecording {
    readonly terminal: BaseTerminalTabComponent<never>
    readonly buffer: CaptureBuffer
    readonly recorder: TabRecorder
    readonly idleStop$: Subject<void>
    readonly subscriptions: Subscription
}

/**
 * Coordinates snag recording across tabs.
 *
 * At most one recording is active at a time. The service:
 *  - listens for the toggle hotkey,
 *  - starts/stops recording on the active terminal tab,
 *  - auto-stops after a configurable period of output silence,
 *  - strips ANSI and writes cleaned text to the OS clipboard,
 *  - reports state changes through Tabby notifications.
 *
 * Leak safety: every per-recording RxJS subscription is collected into a single
 * `Subscription` torn down in `stopRecording()`/`abortRecording()`; the toggle
 * hotkey subscription lives for the app lifetime, which is correct for a
 * singleton service. If the recorded tab is destroyed or its session ends,
 * recording is finalized without touching the dead tab.
 */
@Injectable({ providedIn: 'root' })
export class ClipsnagService {
    private active: ActiveRecording | null = null

    constructor (
        private readonly config: ConfigService,
        private readonly hotkeys: HotkeysService,
        private readonly notifications: NotificationsService,
        private readonly platform: PlatformService,
        private readonly app: AppService,
        private readonly zone: NgZone,
        private readonly decorator: ClipsnagDecorator,
    ) {}

    /** App-lifetime subscription to the toggle hotkey. */
    private hotkeySubscription: Subscription | null = null

    /** Wire up the toggle hotkey. Called once from the plugin module constructor. */
    init (): void {
        if (this.hotkeySubscription) {
            return
        }
        this.hotkeySubscription = this.hotkeys.hotkey$.subscribe(id => {
            if (id !== CLIPSNAG_TOGGLE_HOTKEY) {
                return
            }
            // Hotkey callbacks fire outside the Angular zone; re-enter it so that
            // toast notifications render on the next tick.
            this.zone.run(() => {
                void this.toggle()
            })
        })
    }

    /** True while a capture is in progress. */
    get isRecording (): boolean {
        return this.active !== null
    }

    /** Release app-lifetime resources. Called on plugin/app teardown. */
    dispose (): void {
        this.abortRecording('plugin shut down')
        this.hotkeySubscription?.unsubscribe()
        this.hotkeySubscription = null
    }

    /** Toggle recording on the currently active terminal tab. */
    async toggle (): Promise<void> {
        if (this.active) {
            await this.stopRecording()
            return
        }
        this.startRecording()
    }

    /** Begin capturing the active terminal tab's output. */
    startRecording (): void {
        const terminal = this.resolveActiveTerminal()
        if (!terminal) {
            this.notifications.notice('Clipsnag: no active terminal to record')
            return
        }

        const settings = this.settings()
        const maxBytes = settings.maxCaptureBytes
        const buffer = new CaptureBuffer(maxBytes)

        const idleStop$ = new Subject<void>()
        const subscriptions = new Subscription()

        // Real idle debounce: a timer that is torn down and re-armed on every
        // incoming chunk, so recording only stops after `idleMs` of *silence*.
        const idleMs = settings.autoStopAfterIdleMs
        let idleTimer: Subscription | null = null
        const armIdleTimer = (): void => {
            idleTimer?.unsubscribe()
            const pending = timer(idleMs)
                .pipe(takeUntil(idleStop$))
                .subscribe(() => {
                    this.zone.run(() => {
                        void this.stopRecording(true)
                    })
                })
            idleTimer = pending
            subscriptions.add(pending)
        }

        const recorder = this.decorator.startRecording(terminal, data => {
            // Called synchronously from the terminal data path: keep it trivial and
            // never let a capture error disturb the session.
            buffer.append(data)
            if (idleTimer !== null) {
                armIdleTimer()
            }
        })
        if (!recorder) {
            this.notifications.notice('Clipsnag: this terminal has no live session yet')
            return
        }
        if (idleMs > 0) {
            armIdleTimer()
        }

        // If the tab or its session disappears, finalize without touching it.
        subscriptions.add(
            terminal.destroyed$.subscribe(() => {
                this.zone.run(() => {
                    this.abortRecording('terminal was closed')
                })
            }),
        )
        subscriptions.add(
            terminal.sessionChanged$.subscribe(session => {
                if (!session) {
                    this.zone.run(() => {
                        this.abortRecording('terminal session ended')
                    })
                }
            }),
        )

        this.active = { terminal, buffer, recorder, idleStop$, subscriptions }
        this.notifications.info(
            `Clipsnag: recording "${terminal.title}" — press the hotkey again to stop`,
            `Buffer limit: ${formatBytes(maxBytes)}`,
        )
    }

    /**
     * Stop recording, strip ANSI, and copy to the clipboard.
     * @param automatic true when triggered by the idle timer rather than the hotkey
     */
    async stopRecording (automatic = false): Promise<void> {
        const active = this.active
        if (!active) {
            return
        }
        this.active = null

        active.idleStop$.next()
        active.recorder.dispose()
        active.subscriptions.unsubscribe()

        const text = active.buffer.finish()
        const truncated = active.buffer.isTruncated
        const byteLength = active.buffer.byteLength
        active.buffer.reset()
        active.idleStop$.complete()

        if (text.length === 0) {
            this.notifications.notice('Clipsnag: nothing captured')
            return
        }

        const settings = this.settings()
        if (settings.copyToClipboardOnStop) {
            await this.platform.setClipboard({ text })
        }

        const reason = automatic ? ' (idle timeout)' : ''
        const truncNote = truncated ? ` · truncated at ${formatBytes(settings.maxCaptureBytes)}` : ''
        const action = settings.copyToClipboardOnStop ? 'copied to clipboard' : 'captured (clipboard write disabled)'
        this.notifications.info(
            `Clipsnag: ${action}${reason}`,
            `${formatBytes(byteLength)} of output · ${text.length} characters${truncNote}`,
        )
    }

    /** Finalize a recording because its terminal went away; never touches the tab. */
    private abortRecording (reason: string): void {
        const active = this.active
        if (!active) {
            return
        }
        this.active = null
        active.idleStop$.next()
        active.recorder.dispose()
        active.subscriptions.unsubscribe()
        active.buffer.reset()
        active.idleStop$.complete()
        this.notifications.notice(`Clipsnag: recording cancelled — ${reason}`)
    }

    /**
     * The active tab may be a plain terminal or a `SplitTabComponent` wrapping
     * several. In the split case we record the focused pane.
     */
    private resolveActiveTerminal (): BaseTerminalTabComponent<never> | null {
        const tab = this.app.activeTab
        if (!tab) {
            return null
        }
        if (tab instanceof BaseTerminalTabComponent) {
            return tab as BaseTerminalTabComponent<never>
        }
        if (tab instanceof SplitTabComponent) {
            const focused = tab.getFocusedTab()
            if (focused instanceof BaseTerminalTabComponent) {
                return focused as BaseTerminalTabComponent<never>
            }
        }
        return null
    }

    /** Read + validate plugin settings, falling back to defaults per-field. */
    private settings (): ClipsnagConfig {
        const stored = this.config.store.clipsnag as Partial<ClipsnagConfig> | undefined
        const maxCaptureBytes = Number(stored?.maxCaptureBytes)
        const autoStopAfterIdleMs = Number(stored?.autoStopAfterIdleMs)
        return {
            maxCaptureBytes: Number.isFinite(maxCaptureBytes) && maxCaptureBytes > 0
                ? maxCaptureBytes
                : DEFAULT_CLIPSNAG_CONFIG.maxCaptureBytes,
            autoStopAfterIdleMs: Number.isFinite(autoStopAfterIdleMs) && autoStopAfterIdleMs >= 0
                ? autoStopAfterIdleMs
                : DEFAULT_CLIPSNAG_CONFIG.autoStopAfterIdleMs,
            copyToClipboardOnStop: stored?.copyToClipboardOnStop ?? DEFAULT_CLIPSNAG_CONFIG.copyToClipboardOnStop,
            stopOnTabSwitch: stored?.stopOnTabSwitch ?? DEFAULT_CLIPSNAG_CONFIG.stopOnTabSwitch,
        }
    }
}

function formatBytes (bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
