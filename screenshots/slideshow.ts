/**
 * Builds the animated slideshow for the README and the docs home page from the framed
 * screenshots: docs/images/slideshow.webp (each slide holds, then crossfades into the next).
 */
import sharp from 'sharp'
import { SCREENS } from './frame.ts'

const SLIDES = [
  'using-editor',
  'using-lineage',
  'using-show-data',
  'using-git-modal',
  'using-metadv',
  'scheduler-overview',
  'scheduler-runs-list',
  'scheduler-timeline-memory',
]
const WIDTH = 1200
const HOLD_MS = 3000
const FADE_FRAMES = 6
const FADE_MS = 70
const OUT = new URL('../docs/images/slideshow.webp', import.meta.url).pathname

async function main() {
  const slides = await Promise.all(SLIDES.map(name =>
    sharp(`${SCREENS}${name}.png`).resize({ width: WIDTH }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })))
  const { width, height, channels } = slides[0].info
  for (const s of slides) {
    if (s.info.width !== width || s.info.height !== height) throw new Error('Slides must have the same size')
  }

  const frames: Buffer[] = []
  const delays: number[] = []
  slides.forEach((slide, i) => {
    const next = slides[(i + 1) % slides.length].data
    frames.push(slide.data)
    delays.push(HOLD_MS)
    for (let f = 1; f <= FADE_FRAMES; f++) {
      const t = f / (FADE_FRAMES + 1)
      const blended = Buffer.alloc(slide.data.length)
      for (let p = 0; p < blended.length; p++) blended[p] = slide.data[p] * (1 - t) + next[p] * t
      frames.push(blended)
      delays.push(FADE_MS)
    }
  })

  const strip = Buffer.concat(frames)
  await sharp(strip, { raw: { width, height: height * frames.length, channels: channels as 4, pageHeight: height } })
    .webp({ quality: 72, effort: 6, loop: 0, delay: delays, smartSubsample: true })
    .toFile(OUT)
  const { size } = await sharp(OUT).metadata()
  console.log(`  slideshow: ${slides.length} slides, ${frames.length} frames, ${width}x${height} -> ${OUT}${size ? ` (${size} bytes)` : ''}`)
}

main()
