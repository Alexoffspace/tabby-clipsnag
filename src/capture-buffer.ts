import stripAnsi from 'strip-ansi'

/**
 * One in-flight recording for a single terminal tab.
 *
 * Bytes are accumulated raw (never decoded per chunk) so that multi-byte UTF-8
 * characters split across chunk boundaries survive. Decoding and ANSI stripping
 * both happen exactly once, in `finish()`.
 */
export class CaptureBuffer {
    private readonly chunks: Buffer[] = []
    private capturedBytes = 0
    private truncated = false

    constructor (private readonly maxBytes: number) {}

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
     * truncated; we never exceed `maxBytes` of retained memory.
     */
    append (data: Buffer): void {
        if (data.length === 0) {
            return
        }
        const remaining = this.maxBytes - this.capturedBytes
        if (remaining <= 0) {
            this.truncated = true
            return
        }
        if (data.length > remaining) {
            this.chunks.push(data.subarray(0, remaining))
            this.capturedBytes += remaining
            this.truncated = true
            return
        }
        this.chunks.push(data)
        this.capturedBytes += data.length
    }

    /**
     * Decode, strip ANSI control sequences, and normalise line endings.
     * Callable once per recording; it does not clear the buffer.
     */
    finish (): string {
        const raw = Buffer.concat(this.chunks, this.capturedBytes).toString('utf8')
        const stripped = stripAnsi(raw)
        return stripped.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    }

    /** Drop all retained data (used when a recording is abandoned). */
    reset (): void {
        this.chunks.length = 0
        this.capturedBytes = 0
        this.truncated = false
    }
}
