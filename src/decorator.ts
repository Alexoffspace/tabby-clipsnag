import { TerminalDecorator, BaseTerminalTabComponent, SessionMiddlewareStack, BaseSession } from 'tabby-terminal'
import { CaptureMiddleware } from './capture.middleware'

/**
 * Per-tab recorder handle.
 *
 * Owns the CaptureMiddleware instance that is installed into the tab's current
 * session stack. `dispose()` is idempotent so it is safe to call from both the
 * "user stopped recording" and "tab/session vanished" paths.
 */
export class TabRecorder {
    private disposed = false

    constructor (
        private readonly middleware: CaptureMiddleware,
        private readonly stack: SessionMiddlewareStack,
        onData: (data: Buffer) => void,
    ) {
        middleware.start(onData)
        stack.push(middleware)
    }

    /**
     * Remove the tap from the session stack. We never call `close()` on the
     * middleware: it holds Subjects and calling close() would complete them,
     * making the instance unusable if it were ever reused.
     */
    dispose (): void {
        if (this.disposed) {
            return
        }
        this.disposed = true
        this.middleware.stop()
        this.stack.remove(this.middleware)
    }
}

/**
 * Attaches/detaches per-tab recording support.
 *
 * The decorator does two things:
 *  1. Tracks the tab's *current* session so `startRecording` can find a stack to
 *     install into, updating it whenever the session is replaced (reconnectable
 *     sessions emit `sessionChanged$` more than once).
 *  2. Guarantees cleanup with the tab's lifecycle via `subscribeUntilDestroyed`,
 *     so no map entry or subscription outlives the tab.
 */
export class ClipsnagDecorator extends TerminalDecorator {
    private readonly sessionByTab = new Map<BaseTerminalTabComponent<never>, BaseSession>()

    override attach (terminal: BaseTerminalTabComponent<never>): void {
        if (terminal.session) {
            this.sessionByTab.set(terminal, terminal.session)
        }

        // Fires with the initial session and with every replacement. Tracking the
        // latest session here means a recording started right after a reconnect
        // attaches to the new stack, not the dead one.
        terminal.subscribeUntilDestroyed(terminal.sessionChanged$, session => {
            if (session) {
                this.sessionByTab.set(terminal, session)
            } else {
                this.sessionByTab.delete(terminal)
            }
        })

        terminal.subscribeUntilDestroyed(terminal.destroyed$, () => {
            this.sessionByTab.delete(terminal)
        })
    }

    override detach (terminal: BaseTerminalTabComponent<never>): void {
        super.detach(terminal)
        this.sessionByTab.delete(terminal)
    }

    /**
     * Start forwarding this tab's output into `onData`.
     * Returns `null` when the tab has no live session to tap.
     */
    startRecording (
        terminal: BaseTerminalTabComponent<never>,
        onData: (data: Buffer) => void,
    ): TabRecorder | null {
        const session = this.sessionByTab.get(terminal) ?? terminal.session
        if (!session) {
            return null
        }
        return new TabRecorder(new CaptureMiddleware(), session.middleware, onData)
    }
}
