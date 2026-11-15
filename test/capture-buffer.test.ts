import { describe, expect, it } from 'vitest'
import { CaptureBuffer } from '../src/capture-buffer'

function capture (input: Buffer): string {
    const buffer = new CaptureBuffer(4096)
    buffer.append(input)
    return buffer.finish()
}

describe('CaptureBuffer terminal stripping', () => {
    describe('CSI', () => {
        it('removes SGR sequences', () => {
            expect(
                capture(Buffer.from([
                    0x1b, 0x5b, 0x33, 0x31, 0x6d,
                    0x52, 0x65, 0x64,
                    0x1b, 0x5b, 0x30, 0x6d,
                ])),
            ).toBe('Red')
        })

        it('removes private CSI with ?', () => {
            expect(
                capture(Buffer.from([
                    0x1b, 0x5b, 0x3f, 0x32, 0x35, 0x6c,
                    0x56, 0x69, 0x73, 0x69, 0x62, 0x6c, 0x65,
                ])),
            ).toBe('Visible')
        })

        it('removes private CSI with >', () => {
            expect(
                capture(Buffer.from([
                    0x1b, 0x5b, 0x3e, 0x30, 0x3b,
                    0x32, 0x37, 0x36, 0x3b, 0x30, 0x63,
                    0x44, 0x65, 0x76, 0x69, 0x63, 0x65,
                ])),
            ).toBe('Device')
        })

        it('removes private CSI with <', () => {
            expect(
                capture(Buffer.from([
                    0x1b, 0x5b, 0x3c, 0x75,
                    0x54, 0x65, 0x78, 0x74,
                ])),
            ).toBe('Text')
        })

        it('removes private CSI with =', () => {
            expect(
                capture(Buffer.from([
                    0x1b, 0x5b, 0x3d, 0x30, 0x63,
                    0x54, 0x65, 0x78, 0x74,
                ])),
            ).toBe('Text')
        })

        it('removes scroll-region configuration', () => {
            expect(
                capture(Buffer.from([
                    0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x72,
                    0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74,
                ])),
            ).toBe('Content')
        })

        it('removes CSI cursor save and restore', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5b, 0x73,
                    0x42,
                    0x1b, 0x5b, 0x75,
                    0x43,
                ])),
            ).toBe('ABC')
        })

        it('removes incomplete CSI at end of capture', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5b, 0x3f, 0x32, 0x35,
                ])),
            ).toBe('A')
        })
    })

    describe('ESC sequences', () => {
        it('removes DEC cursor save and restore', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x37,
                    0x42,
                    0x1b, 0x38,
                    0x43,
                ])),
            ).toBe('ABC')
        })

        it('removes sequences with intermediate characters', () => {
            expect(
                capture(Buffer.from([
                    0x1b, 0x28, 0x42,
                    0x41,
                    0x1b, 0x23, 0x38,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('resynchronizes after a malformed escape sequence', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x28,
                    0x0a,
                    0x42,
                ])),
            ).toBe('A\nB')
        })
    })

    describe('OSC', () => {
        it('removes OSC title terminated by BEL', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5d,
                    0x30, 0x3b,
                    0x74, 0x69, 0x74, 0x6c, 0x65,
                    0x07,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('removes OSC title terminated by ESC backslash', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5d,
                    0x30, 0x3b,
                    0x74, 0x69, 0x74, 0x6c, 0x65,
                    0x1b, 0x5c,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('removes OSC title terminated by C1 ST', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5d,
                    0x30, 0x3b,
                    0x74, 0x69, 0x74, 0x6c, 0x65,
                    0x9c,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('preserves OSC-8 hyperlink label', () => {
            expect(
                capture(Buffer.from([
                    0x1b, 0x5d, 0x38, 0x3b, 0x3b,
                    0x68, 0x74, 0x74, 0x70, 0x73,
                    0x3a, 0x2f, 0x2f,
                    0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65,
                    0x2e, 0x74, 0x65, 0x73, 0x74,
                    0x1b, 0x5c,

                    0x63, 0x6c, 0x69, 0x63, 0x6b,
                    0x20,
                    0x6d, 0x65,

                    0x1b, 0x5d, 0x38, 0x3b, 0x3b,
                    0x1b, 0x5c,
                ])),
            ).toBe('click me')
        })

        it('discards an unterminated OSC at EOF', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5d,
                    0x30, 0x3b,
                    0x70, 0x61, 0x72, 0x74, 0x69, 0x61, 0x6c,
                ])),
            ).toBe('A')
        })

        it('resumes after CAN cancels an OSC', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5d,
                    0x30, 0x3b, 0x62, 0x61, 0x64,
                    0x18,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('resynchronizes when an unterminated OSC is interrupted by ESC', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5d,
                    0x30, 0x3b,
                    0x62, 0x61, 0x64,
                    0x1b, 0x5b, 0x33, 0x31, 0x6d,
                    0x42,
                ])),
            ).toBe('AB')
        })
    })

    describe('DCS, APC, PM and SOS', () => {
        it('removes DCS', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x50,
                    0x31, 0x24, 0x71,
                    0x6d,
                    0x1b, 0x5c,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('removes APC', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5f,
                    0x70, 0x61, 0x79, 0x6c, 0x6f, 0x61, 0x64,
                    0x1b, 0x5c,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('removes PM', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x5e,
                    0x70, 0x61, 0x79, 0x6c, 0x6f, 0x61, 0x64,
                    0x1b, 0x5c,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('removes SOS', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x1b, 0x58,
                    0x70, 0x61, 0x79, 0x6c, 0x6f, 0x61, 0x64,
                    0x1b, 0x5c,
                    0x42,
                ])),
            ).toBe('AB')
        })
    })

    describe('8-bit C1 controls', () => {
        it('removes raw C1 CSI', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x9b, 0x33, 0x31, 0x6d,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('removes raw C1 OSC terminated by BEL', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x9d,
                    0x30, 0x3b, 0x74, 0x69, 0x74, 0x6c, 0x65,
                    0x07,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('removes raw C1 control strings terminated by ST', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x90, 0x70, 0x61, 0x79, 0x6c, 0x6f, 0x61, 0x64,
                    0x9c,
                    0x42,

                    0x98, 0x73, 0x9c,
                    0x43,

                    0x9e, 0x70, 0x9c,
                    0x44,

                    0x9f, 0x61, 0x9c,
                    0x45,
                ])),
            ).toBe('ABCDE')
        })

        it('removes other standalone C1 controls', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x84, 0x85, 0x88, 0x8d,
                    0x8e, 0x8f,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('recognizes UTF-8-encoded C1 CSI', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0xc2, 0x9b,
                    0x33, 0x31, 0x6d,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('recognizes UTF-8-encoded C1 ST in a string', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x9d,
                    0x78, 0x79,
                    0xc2, 0x9c,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('does not mistake a UTF-8 continuation byte 0x9B for CSI', () => {
            expect(
                capture(Buffer.from([
                    0xd0, 0x9b,
                    0x41,
                ])),
            ).toBe('ЛA')
        })
    })

    describe('chunk boundaries', () => {
        it('handles control sequences split at every byte boundary', () => {
            const bytes = [
                0x41,

                // CSI color on.
                0x1b, 0x5b, 0x33, 0x31, 0x6d,
                0x58,
                // CSI color off.
                0x1b, 0x5b, 0x30, 0x6d,

                // OSC title with ST termination.
                0x1b, 0x5d,
                0x30, 0x3b,
                0x74, 0x69, 0x74, 0x6c, 0x65,
                0x1b, 0x5c,

                // A UTF-8 Cyrillic character.
                0xd0, 0x9b,

                0x42,
            ]

            // Try every possible two-chunk split.
            for (let split = 0; split <= bytes.length; split++) {
                const buffer = new CaptureBuffer(256)

                buffer.append(Buffer.from(bytes.slice(0, split)))
                buffer.append(Buffer.from(bytes.slice(split)))

                expect(buffer.finish()).toBe('AXЛB')
            }
        })

        it('handles a stream split into one-byte chunks', () => {
            const bytes = [
                0x41,
                0x1b, 0x5b, 0x33, 0x31, 0x6d,
                0x52, 0x65, 0x64,
                0x1b, 0x5b, 0x30, 0x6d,
                0x42,
            ]

            const buffer = new CaptureBuffer(256)

            for (const byte of bytes) {
                buffer.append(Buffer.from([byte]))
            }

            expect(buffer.finish()).toBe('ARedB')
        })

        it('preserves UTF-8 when a multi-byte character spans chunks', () => {
            const buffer = new CaptureBuffer(32)

            buffer.append(Buffer.from([0xd0]))
            buffer.append(Buffer.from([0x9b]))

            expect(buffer.finish()).toBe('Л')
        })
    })

    describe('C0 controls and text normalization', () => {
        it('preserves tabs and normalizes CRLF and standalone CR', () => {
            expect(
                capture(Buffer.from([
                    0x61, 0x00, 0x62,
                    0x09, 0x63,
                    0x0b, 0x64,
                    0x0c, 0x65,
                    0x0d, 0x0a,
                    0x66,
                    0x0d,
                    0x67,
                ])),
            ).toBe('ab\tcde\nf\ng')
        })

        it('removes NUL, BEL, VT, FF and other C0 controls', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0x00, 0x01, 0x02,
                    0x07, 0x0b, 0x0c,
                    0x0e, 0x0f,
                    0x1a, 0x1c, 0x1f,
                    0x7f,
                    0x42,
                ])),
            ).toBe('AB')
        })

        it('applies destructive backspace to the previous character', () => {
            expect(
                capture(Buffer.from([
                    0x61, 0x62, 0x63,
                    0x08,
                    0x58,
                ])),
            ).toBe('abX')
        })

        it('backspaces over a multi-byte UTF-8 character safely', () => {
            expect(
                capture(Buffer.from([
                    0xd1, 0x8f,
                    0x08,
                    0x58,
                ])),
            ).toBe('X')
        })

        it('does not backspace across a newline', () => {
            expect(
                capture(Buffer.from([
                    0x41, 0x0a, 0x08, 0x42,
                ])),
            ).toBe('A\nB')
        })
    })

    describe('real-world terminal output', () => {
        it('preserves percent signs and TUI progress-bar brackets', () => {
            expect(
                capture(Buffer.from([
                    0x5b,
                    0x23, 0x23, 0x23, 0x23,
                    0x5d, 0x20,
                    0x34, 0x35, 0x25,
                ])),
            ).toBe('[####] 45%')
        })

        it('strips ls --color=always while preserving filenames', () => {
            expect(
                capture(Buffer.from([
                    0x1b, 0x5b,
                    0x30, 0x31, 0x3b, 0x33, 0x34, 0x6d,
                    0x66, 0x6f, 0x6c, 0x64, 0x65, 0x72,
                    0x1b, 0x5b, 0x30, 0x6d,
                    0x0a,
                ])),
            ).toBe('folder\n')
        })

        it('preserves git log graph glyphs and strips colors', () => {
            expect(
                capture(Buffer.from([
                    // * <yellow>abc123</reset> Merge
                    0x2a, 0x20,
                    0x1b, 0x5b, 0x33, 0x33, 0x6d,
                    0x61, 0x62, 0x63, 0x31, 0x32, 0x33,
                    0x1b, 0x5b, 0x30, 0x6d,
                    0x20, 0x4d, 0x65, 0x72, 0x67, 0x65,
                    0x0a,

                    // │ * <green>def456</reset> Add
                    0xe2, 0x94, 0x82,
                    0x20, 0x2a, 0x20,
                    0x1b, 0x5b, 0x33, 0x32, 0x6d,
                    0x64, 0x65, 0x66, 0x34, 0x35, 0x36,
                    0x1b, 0x5b, 0x30, 0x6d,
                    0x20, 0x41, 0x64, 0x64,
                    0x0a,

                    // └─
                    0xe2, 0x94, 0x94,
                    0xe2, 0x94, 0x80,
                ])),
            ).toBe('* abc123 Merge\n│ * def456 Add\n└─')
        })
    })

    describe('invalid UTF-8', () => {
        it('drops malformed bytes without generating U+FFFD', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0xe2, 0x28, 0xa1,
                    0x42,
                ])),
            ).toBe('A(B')
        })

        it('drops incomplete UTF-8 at EOF', () => {
            expect(
                capture(Buffer.from([
                    0x41,
                    0xf0, 0x9f, 0x92,
                ])),
            ).toBe('A')
        })

        it('preserves a deliberately encoded valid U+FFFD', () => {
            expect(
                capture(Buffer.from([
                    0xef, 0xbf, 0xbd,
                ])),
            ).toBe('\uFFFD')
        })

        it('preserves valid box-drawing and block characters', () => {
            expect(
                capture(Buffer.from([
                    0xe2, 0x94, 0x82,
                    0xe2, 0x94, 0x9c,
                    0xe2, 0x94, 0x94,
                    0xe2, 0x96, 0x88,
                ])),
            ).toBe('│├└█')
        })
    })

    describe('capture bounds and lifecycle', () => {
        it('keeps byteLength based on raw accepted bytes', () => {
            const buffer = new CaptureBuffer(64)
            const input = Buffer.from([
                0x1b, 0x5b, 0x33, 0x31, 0x6d,
                0x52, 0x65, 0x64,
            ])

            buffer.append(input)

            expect(buffer.byteLength).toBe(input.length)
            expect(buffer.finish()).toBe('Red')
        })

        it('marks truncated when the capture limit is exceeded', () => {
            const buffer = new CaptureBuffer(4)

            buffer.append(Buffer.from([
                0x41, 0x42, 0x43,
            ]))

            buffer.append(Buffer.from([
                0x44, 0x45,
            ]))

            expect(buffer.byteLength).toBe(4)
            expect(buffer.isTruncated).toBe(true)
            expect(buffer.finish()).toBe('ABCD')
        })

        it('does not retain a reference to the caller buffer', () => {
            const input = Buffer.from([0x41])
            const buffer = new CaptureBuffer(16)

            buffer.append(input)
            input[0] = 0x42

            expect(buffer.finish()).toBe('A')
        })

        it('reset clears the capture and allows reuse', () => {
            const buffer = new CaptureBuffer(16)

            buffer.append(Buffer.from([0x41]))
            buffer.reset()

            expect(buffer.byteLength).toBe(0)
            expect(buffer.isTruncated).toBe(false)
            expect(buffer.finish()).toBe('')

            buffer.append(Buffer.from([0x42]))

            expect(buffer.finish()).toBe('B')
        })

        it('keeps independent captures isolated between tabs', () => {
            const tabA = new CaptureBuffer(16)
            const tabB = new CaptureBuffer(16)

            tabA.append(Buffer.from([0x41]))
            tabB.append(Buffer.from([0x42]))

            tabA.reset()

            expect(tabA.finish()).toBe('')
            expect(tabB.finish()).toBe('B')
        })

        it('rejects invalid maxBytes values', () => {
            expect(() => new CaptureBuffer(-1)).toThrow(RangeError)
            expect(() => new CaptureBuffer(1.5)).toThrow(RangeError)
        })
    })
})
