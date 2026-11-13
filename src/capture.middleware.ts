import { Buffer } from 'buffer'
import { SessionMiddleware } from 'tabby-terminal'

/**
 * Passive tap on the session output stream.
 *
 * `feedFromSession` receives bytes travelling FROM the session TO the terminal
 * (i.e. the program's stdout/stderr as rendered). We hand a copy to the sink and
 * then ALWAYS forward the original bytes — capturing must never alter the stream.
 *
 * The middleware is a no-op when `sink` is `null`, so it can safely stay in the
 * stack across record/stop cycles without re-wiring subscriptions.
 */
export class CaptureMiddleware extends SessionMiddleware {
    private sink: ((data: Buffer) => void) | null = null

    /** Begin forwarding copies of session output to `sink`. */
    start (sink: (data: Buffer) => void): void {
        this.sink = sink
    }

    /** Stop forwarding (the terminal keeps receiving data normally). */
    stop (): void {
        this.sink = null
    }

    override feedFromSession (data: Buffer): void {
        const sink = this.sink
        if (sink) {
            // Copy is unnecessary: `data` is not mutated downstream and the sink
            // only reads synchronously. Pass through unchanged regardless.
            sink(data)
        }
        super.feedFromSession(data)
    }
}
