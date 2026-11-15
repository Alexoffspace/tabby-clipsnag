import { stripTerminalControlsInPlace } from './strip-terminal-controls'

/**
 * One in-flight recording for a single terminal tab.
 *
 * Bytes are accumulated raw (never decoded per chunk) so that multi-byte UTF-8
 * characters split across chunk boundaries survive. Terminal control sequences
 * are stripped in place and the buffer is decoded to a string exactly once, in
 * `finish()`.
 */
export class CaptureBuffer {
    private readonly chunks: Buffer[] = []
    private capturedBytes = 0
    private truncated = false

    constructor (private readonly maxBytes: number) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
            throw new RangeError('maxBytes must be a non-negative safe integer')
        }
    }

    /** Bytes retained so far (always <= maxBytes). */
    get byteLength (): number {
        return this.capturedBytes
    }

    /** True once the cap was hit and later chunks were dropped. */
    get isTruncated (): boolean {
        return this.truncated
    }

    /**
     * Append a chunk. Chunks past the cap are dropped and the buffer is marked
     * truncated; we never exceed `maxBytes` of retained memory. A private copy
     * is stored so the producer cannot mutate captured data through a shared
     * Buffer reference.
     */
    append (data: Buffer): void {
        if (data.length === 0) {
            return
        }

        const remaining = this.maxBytes - this.capturedBytes
        const accepted = remaining > 0 ? Math.min(data.length, remaining) : 0

        if (accepted > 0) {
            this.chunks.push(Buffer.from(data.subarray(0, accepted)))
            this.capturedBytes += accepted
        }

        if (accepted < data.length) {
            this.truncated = true
        }
    }

    /**
     * Strip terminal control sequences and decode the capture to a string.
     * Callable more than once per recording; it does not clear the buffer.
     */
    finish (): string {
        const raw = Buffer.concat(this.chunks, this.capturedBytes)
        return stripTerminalControlsInPlace(raw).toString('utf8')
    }

    /** Drop all retained data (used when a recording is abandoned). */
    reset (): void {
        this.chunks.length = 0
        this.capturedBytes = 0
        this.truncated = false
    }
}
