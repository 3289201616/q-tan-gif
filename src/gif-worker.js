import { GIFEncoder, quantize, applyPalette } from 'gifenc'

/**
 * GIF is assembled in a worker so the plush keeps breathing while the frames
 * are quantised. The palette is global across the animation to avoid colour
 * shimmer, which is particularly noticeable on a soft gradient background.
 */

function collectPaletteSamples(frames, pixelCount) {
  const frameCount = frames.length
  const picks = Math.min(6, frameCount)
  const stride = Math.max(1, Math.floor(pixelCount / 52000))
  const sampledPixels = Math.min(52000, Math.ceil(pixelCount / stride))
  const sample = new Uint8ClampedArray(sampledPixels * picks * 4)
  let offset = 0

  for (let pick = 0; pick < picks; pick += 1) {
    const frameIndex = Math.min(frameCount - 1, Math.floor((pick * frameCount) / picks))
    const data = frames[frameIndex]
    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
      const source = pixel * 4
      sample[offset] = data[source]
      sample[offset + 1] = data[source + 1]
      sample[offset + 2] = data[source + 2]
      sample[offset + 3] = data[source + 3]
      offset += 4
    }
  }
  return sample.subarray(0, offset)
}

self.onmessage = (event) => {
  const { width, height, buffers, delayMs, quality = 256, transparent = false } = event.data || {}
  try {
    if (!width || !height || !buffers?.length) throw new Error('缺少帧数据')
    const pixelCount = width * height
    const frames = buffers.map((buffer) => new Uint8ClampedArray(buffer))
    const total = frames.length

    self.postMessage({ type: 'progress', progress: 0.05, label: '正在调色…' })

    const sample = collectPaletteSamples(frames, pixelCount)
    let palette
    let transparentIndex = -1
    const maxColors = Math.max(64, Math.min(256, Number(quality) || 256))

    if (transparent) {
      palette = quantize(sample, Math.min(255, maxColors), {
        format: 'rgba4444',
        oneBitAlpha: true,
        clearAlpha: true,
        clearAlphaColor: 0,
      })
      transparentIndex = palette.findIndex((color) => (color[3] ?? 255) === 0)
      if (transparentIndex < 0) {
        if (palette.length < 256) palette.push([0, 0, 0, 0])
        transparentIndex = palette.length - 1
      }
    } else {
      palette = quantize(sample, maxColors, { format: 'rgb565' })
    }

    if (!palette.length) throw new Error('调色失败')

    const gif = GIFEncoder()
    const format = transparent ? 'rgba4444' : 'rgb565'
    const delay = Math.max(20, Math.round(delayMs || 40))

    for (let index = 0; index < total; index += 1) {
      const indexed = applyPalette(frames[index], palette, format)
      gif.writeFrame(indexed, width, height, {
        palette: index === 0 ? palette : undefined,
        delay,
        transparent,
        transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
        repeat: index === 0 ? 0 : undefined,
        dispose: transparent ? 2 : -1,
      })
      frames[index] = null

      if (index % 2 === 0 || index === total - 1) {
        self.postMessage({
          type: 'progress',
          progress: 0.05 + ((index + 1) / total) * 0.9,
          label: `正在装订第 ${index + 1}/${total} 帧`,
        })
      }
    }

    gif.finish()
    self.postMessage({ type: 'progress', progress: 1, label: '马上就好' })
    const bytes = gif.bytes()
    self.postMessage({ type: 'done', buffer: bytes.buffer }, [bytes.buffer])
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
