/**
 * ProxyShift — Icon Generator
 * Generates icon16.png, icon48.png, icon128.png
 * Usage: node scripts/generate-icons.js
 * Requires Node.js 14+ (no extra dependencies)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── PNG Writer ───────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = crc32(crcInput);
  return Buffer.concat([uint32be(data.length), typeBytes, data, uint32be(crc)]);
}

/**
 * Create a PNG buffer from an RGBA pixel array.
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => [number, number, number, number]} getPixel
 */
function createPNG(width, height, getPixel) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.concat([
    uint32be(width),
    uint32be(height),
    Buffer.from([8, 6, 0, 0, 0]), // 8-bit RGBA
  ]);
  const ihdr = pngChunk('IHDR', ihdrData);

  // Build raw pixel data (filter byte 0 per scanline)
  const rawData = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      rawData[offset] = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
      rawData[offset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIG, ihdr, idat, iend]);
}

// ─── Icon Drawing ─────────────────────────────────────────────────────────────

/**
 * Draw the ProxyShift shield icon.
 * Dark indigo shield with a glowing dot in the center.
 */
function drawShield(size) {
  return createPNG(size, size, (px, py) => {
    const cx = size / 2;
    const cy = size / 2;
    const x = (px - cx) / (size / 2);  // -1 to 1
    const y = (py - cy) / (size / 2);

    // Background: transparent
    let r = 0, g = 0, b = 0, a = 0;

    // Shield shape using a simplified path
    // Shield: wider at top, narrows to point at bottom
    const shieldTop = -0.85;
    const shieldBottom = 0.95;
    const shieldWidth = (t) => {
      if (t < -0.5) return 0.85;         // Top flat
      if (t < 0.3) return 0.85 - (t + 0.5) * 0.3; // Slight taper
      return 0.85 - (t + 0.5) * 0.7;    // Sharp taper to point
    };

    const inShield = y >= shieldTop && y <= shieldBottom && Math.abs(x) <= shieldWidth(y);

    if (inShield) {
      // Gradient: dark indigo bg
      const depth = (y - shieldTop) / (shieldBottom - shieldTop);
      r = Math.round(40 + depth * 20);
      g = Math.round(35 + depth * 15);
      b = Math.round(100 + depth * 30);
      a = 255;

      // Inner shield overlay (lighter)
      const innerScale = 0.7;
      const inInner = y >= shieldTop * innerScale &&
                      y <= shieldBottom * innerScale &&
                      Math.abs(x) <= shieldWidth(y) * innerScale;
      if (inInner) {
        r = Math.round(60 + depth * 30);
        g = Math.round(55 + depth * 20);
        b = Math.round(160 + depth * 30);
        a = 255;
      }

      // Center dot / glow
      const dotRadius = 0.18;
      const dotDist = Math.sqrt(x * x + (y - 0.1) * (y - 0.1));
      if (dotDist < dotRadius) {
        const t = 1 - dotDist / dotRadius;
        r = Math.round(r + (180 - r) * t);
        g = Math.round(g + (160 - g) * t);
        b = Math.round(b + (255 - b) * t);
        a = 255;
      }

      // Subtle edge anti-aliasing
      const edgeDist = Math.min(
        Math.abs(Math.abs(x) - shieldWidth(y)),
        y - shieldTop,
        shieldBottom - y
      );
      if (edgeDist < 0.08) {
        a = Math.round(a * Math.max(0, edgeDist / 0.08));
      }
    }

    return [
      Math.max(0, Math.min(255, r)),
      Math.max(0, Math.min(255, g)),
      Math.max(0, Math.min(255, b)),
      Math.max(0, Math.min(255, a)),
    ];
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

const sizes = [16, 48, 128];
for (const size of sizes) {
  const buf = drawShield(size);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`✓ Created ${outPath} (${buf.length} bytes)`);
}

console.log('\nIcons generated successfully! Load proxyshift/ as an unpacked extension.');
