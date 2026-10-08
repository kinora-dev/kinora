import { Buffer } from 'node:buffer'
import { crc32, deflateSync } from 'node:zlib'

type Rgb = [number, number, number]

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

// Minimal truecolor PNG encoder, so the seed needs no image fixtures or dependencies.
function png(width: number, height: number, pixel: (x: number, y: number) => Rgb): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++)
      raw.set(pixel(x, y), row + 1 + x * 3)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const WIDTH = 320
const HEIGHT = 120
const PAGE: Rgb = [244, 244, 245]

// A "button" on a page: a filled rectangle whose left edge and color can drift.
function button(left: number, color: Rgb): (x: number, y: number) => Rgb {
  return (x, y) => (x >= left && x < left + 120 && y >= 40 && y < 80 ? color : PAGE)
}

// The three images Playwright attaches when `toHaveScreenshot` fails: the baseline, what the
// test rendered (button nudged and recolored), and their pixel diff in red.
export function seedScreenshotComparison(): { expected: Buffer, actual: Buffer, diff: Buffer } {
  const expected = button(100, [79, 70, 229])
  const actual = button(112, [67, 56, 202])
  return {
    expected: png(WIDTH, HEIGHT, expected),
    actual: png(WIDTH, HEIGHT, actual),
    diff: png(WIDTH, HEIGHT, (x, y) => (expected(x, y).join() === actual(x, y).join() ? [255, 255, 255] : [239, 68, 68])),
  }
}
