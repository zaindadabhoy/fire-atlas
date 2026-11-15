import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import path from 'node:path'
const seconds = process.argv.slice(2).map(Number)
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') })
const composition = await selectComposition({ serveUrl, id: 'FireAtlasLong' })
for (const s of seconds) {
  const frame = Math.round(s * 30)
  await renderStill({ composition, serveUrl, frame, output: path.resolve(`../long/review/s_${String(s).padStart(5, '0')}.jpg`), imageFormat: 'jpeg', jpegQuality: 70, scale: 0.5 })
  console.log('still', s)
}
