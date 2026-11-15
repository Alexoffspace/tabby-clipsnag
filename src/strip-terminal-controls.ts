/**
 * Byte-oriented terminal control-sequence stripper.
 *
 * It operates on the raw PTY byte stream, *before* UTF-8 decoding, so that:
 *  - raw 8-bit C1 controls (0x80-0x9F) are still recognizable (the decoder would
 *    have turned them into U+FFFD and lost the information);
 *  - malformed UTF-8 can be dropped before it becomes a replacement glyph;
 *  - a valid UTF-8 code point that happens to contain a continuation byte in the
 *    0x80-0x9F range (e.g. Cyrillic "Л" = D0 9B) is preserved.
 *
 * The scanner has no persistent state: `finish()` concatenates every stored chunk
 * first, so sequences split across PTY chunks are reassembled before parsing.
 */

interface Utf8Unit {
    readonly codePoint: number
    readonly length: number
    readonly valid: boolean
}

const ESC = 0x1b
const BEL = 0x07
const BS = 0x08
const HT = 0x09
const LF = 0x0a
const CR = 0x0d
const CAN = 0x18
const SUB = 0x1a
const DEL = 0x7f

function isContinuation (byte: number): boolean {
    return byte >= 0x80 && byte <= 0xbf
}

function invalidUtf8Unit (): Utf8Unit {
    return {
        codePoint: 0,
        length: 1,
        valid: false,
    }
}

/**
 * Read exactly one UTF-8 code point without decoding the buffer into a string.
 *
 * Invalid sequences consume one byte only. This allows subsequent valid ASCII
 * and UTF-8 bytes to survive malformed input.
 */
function readUtf8Unit (input: Buffer, offset: number): Utf8Unit {
    const first = input[offset]

    if (first === undefined) {
        return invalidUtf8Unit()
    }

    if (first <= 0x7f) {
        return {
            codePoint: first,
            length: 1,
            valid: true,
        }
    }

    if (first >= 0xc2 && first <= 0xdf) {
        const second = input[offset + 1]

        if (
            second === undefined ||
            !isContinuation(second)
        ) {
            return invalidUtf8Unit()
        }

        return {
            codePoint: ((first & 0x1f) << 6) |
                (second & 0x3f),
            length: 2,
            valid: true,
        }
    }

    if (first >= 0xe0 && first <= 0xef) {
        const second = input[offset + 1]
        const third = input[offset + 2]

        if (
            second === undefined ||
            third === undefined ||
            !isContinuation(second) ||
            !isContinuation(third) ||
            (first === 0xe0 && second < 0xa0) ||
            (first === 0xed && second > 0x9f)
        ) {
            return invalidUtf8Unit()
        }

        return {
            codePoint:
                ((first & 0x0f) << 12) |
                ((second & 0x3f) << 6) |
                (third & 0x3f),
            length: 3,
            valid: true,
        }
    }

    if (first >= 0xf0 && first <= 0xf4) {
        const second = input[offset + 1]
        const third = input[offset + 2]
        const fourth = input[offset + 3]

        if (
            second === undefined ||
            third === undefined ||
            fourth === undefined ||
            !isContinuation(second) ||
            !isContinuation(third) ||
            !isContinuation(fourth) ||
            (first === 0xf0 && second < 0x90) ||
            (first === 0xf4 && second > 0x8f)
        ) {
            return invalidUtf8Unit()
        }

        return {
            codePoint:
                ((first & 0x07) << 18) |
                ((second & 0x3f) << 12) |
                ((third & 0x3f) << 6) |
                (fourth & 0x3f),
            length: 4,
            valid: true,
        }
    }

    return invalidUtf8Unit()
}

/**
 * Skip a CSI sequence.
 *
 * CSI grammar:
 *   Parameter bytes:    0x30 - 0x3F
 *   Intermediate bytes: 0x20 - 0x2F
 *   Final byte:         0x40 - 0x7E
 *
 * The complete parameter range is accepted (including private markers ?, >, =
 * and <) instead of enumerating individual CSI commands.
 *
 * CAN and SUB cancel the sequence. A nested ESC interrupts it and is processed
 * again by the main scanner.
 */
function skipCsi (input: Buffer, offset: number): number {
    let index = offset

    while (index < input.length) {
        const byte = input[index]

        if (byte === undefined) {
            return input.length
        }

        if (byte === CAN || byte === SUB) {
            return index + 1
        }

        if (byte === ESC) {
            return index
        }

        if (byte >= 0x40 && byte <= 0x7e) {
            return index + 1
        }

        if (byte >= 0x20 && byte <= 0x3f) {
            index++
            continue
        }

        if (byte < 0x20) {
            index++
            continue
        }

        // A non-ASCII byte is not a valid CSI parameter/intermediate/final.
        // Stop here so the main scanner can process it independently.
        return index
    }

    // An unterminated CSI consumes the remainder of the capture.
    return input.length
}

/**
 * Skip an OSC, DCS, APC, PM or SOS control string.
 *
 * OSC terminates on BEL, ESC \ or C1 ST. Other control strings terminate on
 * ESC \ or C1 ST. Both raw 8-bit C1 ST (0x9C) and its UTF-8 representation
 * (C2 9C) are recognized.
 *
 * CAN and SUB cancel a control string. An unexpected ESC or a nested OSC ends
 * the current string so that the main scanner can resynchronize.
 */
function skipControlString (input: Buffer, offset: number, osc: boolean): number {
    let index = offset

    while (index < input.length) {
        const byte = input[index]

        if (byte === undefined) {
            return input.length
        }

        if (osc && byte === BEL) {
            return index + 1
        }

        if (byte === CAN || byte === SUB) {
            return index + 1
        }

        if (byte === ESC) {
            if (index + 1 < input.length && input[index + 1] === 0x5c) {
                return index + 2
            }

            // Not ST. Let the main scanner handle this ESC.
            return index
        }

        const unit = readUtf8Unit(input, index)

        if (unit.valid) {
            if (unit.codePoint === 0x009c) {
                return index + unit.length
            }

            if (unit.codePoint === 0x009d) {
                // A new OSC introducer interrupts an unterminated string.
                return index
            }

            index += unit.length
            continue
        }

        // Raw C1 ST and OSC bytes are invalid UTF-8 as individual bytes, but
        // have control meaning in an 8-bit terminal stream.
        if (byte === 0x9c) {
            return index + 1
        }

        if (byte === 0x9d) {
            return index
        }

        index++
    }

    // An unterminated control string consumes the remainder of the capture.
    return input.length
}

/**
 * Dispatch a C1 control code.
 *
 * `offset` points to the first byte of the C1 code; `length` is 1 for raw
 * 8-bit C1 or 2 for a UTF-8-encoded C1 code point.
 */
function skipC1Sequence (input: Buffer, offset: number, length: number, codePoint: number): number {
    // CSI, OSC and the control-string families need a sub-parser; every other
    // C1 control is a single-character control.
    if (codePoint === 0x009b) {
        return skipCsi(input, offset + length)
    }

    if (codePoint === 0x009d) {
        return skipControlString(input, offset + length, true)
    }

    if (
        codePoint === 0x0090 ||
        codePoint === 0x0098 ||
        codePoint === 0x009e ||
        codePoint === 0x009f
    ) {
        return skipControlString(input, offset + length, false)
    }

    return offset + length
}

/**
 * Skip a 7-bit ESC sequence.
 *
 * Handles ESC [ (CSI), ESC ] (OSC), ESC P (DCS), ESC _ (APC), ESC ^ (PM) and
 * ESC X (SOS). All other ESC sequences follow the general grammar:
 *
 *   ESC + zero or more intermediate bytes (0x20 - 0x2F) + one final byte (0x30 - 0x7E)
 *
 * This covers cursor save/restore, charset selection and ESC sequences with
 * intermediate characters.
 */
function skipEscapeSequence (input: Buffer, escapeOffset: number): number {
    const nextOffset = escapeOffset + 1
    const introducer = input[nextOffset]

    if (introducer === undefined) {
        return input.length
    }

    if (introducer === 0x5b) {
        // CSI: ESC [
        return skipCsi(input, nextOffset + 1)
    }

    if (introducer === 0x5d) {
        // OSC: ESC ]
        return skipControlString(input, nextOffset + 1, true)
    }

    if (
        introducer === 0x50 ||
        introducer === 0x5f ||
        introducer === 0x5e ||
        introducer === 0x58
    ) {
        // DCS (ESC P), APC (ESC _), PM (ESC ^), SOS (ESC X)
        return skipControlString(input, nextOffset + 1, false)
    }

    let index = nextOffset

    while (index < input.length) {
        const byte = input[index]

        if (byte === undefined || byte < 0x20 || byte > 0x2f) {
            break
        }

        index++
    }

    if (index >= input.length) {
        // Incomplete ESC sequence with intermediate characters.
        return input.length
    }

    const finalByte = input[index]

    if (finalByte !== undefined && finalByte >= 0x30 && finalByte <= 0x7e) {
        return index + 1
    }

    // Malformed sequence: discard ESC and any intermediate bytes, but let the
    // unexpected byte be processed normally.
    return index === nextOffset ? nextOffset : index
}

/**
 * Destructively erase the preceding Unicode code point.
 *
 * The output buffer contains only valid UTF-8 at this point. Newlines are
 * boundaries and are never erased by a backspace.
 */
function erasePreviousCodePoint (output: Buffer, outputLength: number): number {
    if (outputLength === 0 || output[outputLength - 1] === LF) {
        return outputLength
    }

    let start = outputLength - 1

    while (start > 0 && isContinuation(output[start] as number)) {
        start--
    }

    return start
}

/**
 * Remove terminal control sequences and invalid UTF-8 bytes in place.
 *
 * Guarantees:
 *  - Never creates a larger buffer; the result is a view into `input`.
 *  - Does not decode UTF-8; valid printable sequences are copied byte-for-byte.
 *  - Sequences split across the original PTY chunks are handled as long as the
 *    caller concatenates those chunks first.
 */
export function stripTerminalControlsInPlace (input: Buffer): Buffer {
    let read = 0
    let write = 0

    while (read < input.length) {
        const byte = input[read]

        if (byte === undefined) {
            break
        }

        // 7-bit ESC sequences.
        if (byte === ESC) {
            read = skipEscapeSequence(input, read)
            continue
        }

        // CRLF becomes one LF; a standalone CR also becomes LF.
        if (byte === CR) {
            input[write++] = LF

            if (input[read + 1] === LF) {
                read += 2
            } else {
                read++
            }

            continue
        }

        // Preserve tabs and line feeds exactly.
        if (byte === HT || byte === LF) {
            input[write++] = byte
            read++
            continue
        }

        // Destructive backspace handling.
        if (byte === BS) {
            write = erasePreviousCodePoint(input, write)
            read++
            continue
        }

        // Remove all other C0 controls and DEL.
        if (byte < 0x20 || byte === DEL) {
            read++
            continue
        }

        // Printable ASCII.
        if (byte < 0x80) {
            input[write++] = byte
            read++
            continue
        }

        const unit = readUtf8Unit(input, read)

        if (unit.valid) {
            // Recognize Unicode-encoded C1 controls, e.g. C2 9B.
            if (unit.codePoint >= 0x0080 && unit.codePoint <= 0x009f) {
                read = skipC1Sequence(input, read, unit.length, unit.codePoint)
                continue
            }

            // Keep the original UTF-8 bytes without decoding or re-encoding.
            input.copy(input, write, read, read + unit.length)

            write += unit.length
            read += unit.length
            continue
        }

        // Raw 8-bit C1 controls are invalid UTF-8 individually, but are
        // recognized before invalid-byte removal.
        if (byte >= 0x80 && byte <= 0x9f) {
            read = skipC1Sequence(input, read, 1, byte)
            continue
        }

        // Drop one malformed UTF-8 byte and retry at the next byte.
        read++
    }

    return input.subarray(0, write)
}
