/** Puts a raw screenshot into a simple dark browser window and saves it for the docs. */
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

export const SCREENS = new URL('../docs/images/screens/', import.meta.url).pathname
const BAR = 40
const RADIUS = 10
const URL_TEXT = 'dbt-ui.example.com'

/** Title bar and rounded window outline as SVG, for an image of width x height */
function chrome(width: number, height: number) {
  const dots = ['#ff5f57', '#febc2e', '#28c840']
    .map((c, i) => `<circle cx="${22 + i * 20}" cy="${BAR / 2}" r="6" fill="${c}"/>`).join('')
  const urlWidth = Math.min(520, width * 0.4)
  const urlX = (width - urlWidth) / 2
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + BAR}">
    <rect x="0" y="0" width="${width}" height="${BAR}" fill="#2b2b2e"/>
    <line x1="0" y1="${BAR - 0.5}" x2="${width}" y2="${BAR - 0.5}" stroke="#3c3c40"/>
    ${dots}
    <rect x="${urlX}" y="8" width="${urlWidth}" height="${BAR - 16}" rx="6" fill="#1c1c1e"/>
    <text x="${width / 2}" y="${BAR / 2 + 4.5}" text-anchor="middle" fill="#a0a0a6"
      font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">${URL_TEXT}</text>
  </svg>`)
}

/** Rounded-corner mask for the whole window */
const mask = (width: number, height: number) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="0" y="0" width="${width}" height="${height}" rx="${RADIUS}" fill="#fff"/></svg>`,
)

/** Thin outline so the window stands out on dark pages */
const outline = (width: number, height: number) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${RADIUS}" fill="none" stroke="#4a4a50"/></svg>`,
)

/** Returns the framed image as a PNG buffer (full resolution) */
export async function framed(raw: string | Buffer): Promise<Buffer> {
  const image = sharp(raw)
  const { width, height } = await image.metadata()
  const total = height! + BAR
  const window = await sharp(chrome(width!, height!))
    .composite([{ input: await image.png().toBuffer(), top: BAR, left: 0 }])
    .png().toBuffer()
  return sharp(window)
    .composite([
      { input: mask(width!, total), blend: 'dest-in' },
      { input: outline(width!, total) },
    ])
    .png().toBuffer()
}

/** Frames out/raw/<name>.png into docs/images/screens/<name>.png */
export async function frame(raw: string, name: string) {
  mkdirSync(SCREENS, { recursive: true })
  await sharp(await framed(raw))
    .png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 })
    .toFile(`${SCREENS}${name}.png`)
}
