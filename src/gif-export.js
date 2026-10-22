import { nextFrame } from './utils.js'

function abortError() {
  const error = new Error('已取消导出')
  error.name = 'AbortError'
  return error
}

export async function exportGif({ stage, settings, signal, onProgress }) {
  const fps = Number(settings.fps) || 25
  const duration = Number(settings.loopDuration) || 2
  const frameCount = Math.max(1, Math.round(duration * fps))
  const { width, height } = stage.getOutputSize(Number(settings.size) || 480)
  const transparent = settings.background === 'transparent'
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
  if (!ctx) throw new Error('浏览器不支持画布导出')

  onProgress?.({
    phase: 'render',
    progress: 0.01,
    label: `正在铺好 ${width} × ${height} 的画布`,
    frames: frameCount,
  })

  const frames = []
  stage.beginExport(width, height)
  try {
    for (let index = 0; index < frameCount; index += 1) {
      if (signal?.aborted) throw abortError()
      const time = index / fps
      stage.renderExportFrame(ctx, time)
      const imageData = ctx.getImageData(0, 0, width, height)
      frames.push(imageData.data)

      onProgress?.({
        phase: 'render',
        progress: 0.02 + ((index + 1) / frameCount) * 0.68,
        label: `正在揉第 ${index + 1}/${frameCount} 帧`,
        current: index + 1,
        frames: frameCount,
      })

      // Give the browser a chance to repaint the progress card. Rendering a
      // 480px frame is quick, but 3D models can be heavier.
      if (index < frameCount - 1) await nextFrame()
    }
  } finally {
    stage.endExport()
  }

  if (signal?.aborted) throw abortError()

  onProgress?.({
    phase: 'encode',
    progress: 0.73,
    label: '正在调色和装订 GIF',
    current: frameCount,
    frames: frameCount,
  })

  const buffer = await encodeFrames({
    frames,
    width,
    height,
    fps,
    transparent,
    quality: Number(settings.quality) || 256,
    signal,
    onProgress,
  })

  const blob = new Blob([buffer], { type: 'image/gif' })
  return {
    blob,
    width,
    height,
    frameCount,
    fps,
    duration: frameCount / fps,
    transparent,
    bytes: blob.size,
  }
}

function encodeFrames({ frames, width, height, fps, transparent, quality, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(new URL('./gif-worker.js', import.meta.url), { type: 'module' })
    } catch (error) {
      reject(new Error('当前环境无法启动 GIF 编码线程'))
      return
    }

    let settled = false
    let abortTimer = 0
    const cleanup = () => {
      if (settled) return
      settled = true
      if (abortTimer) window.clearInterval(abortTimer)
      abortTimer = 0
      worker?.terminate()
      worker = null
    }

    worker.onmessage = (event) => {
      const data = event.data || {}
      if (data.type === 'progress') {
        onProgress?.({
          phase: 'encode',
          progress: 0.73 + Number(data.progress || 0) * 0.26,
          label: data.label || '正在装订 GIF',
          current: frames.length,
          frames: frames.length,
        })
        return
      }
      if (data.type === 'done') {
        cleanup()
        resolve(data.buffer)
        return
      }
      if (data.type === 'error') {
        cleanup()
        reject(new Error(data.message || 'GIF 编码失败'))
      }
    }

    worker.onerror = (event) => {
      cleanup()
      reject(new Error(event?.message || 'GIF 编码线程出错'))
    }

    const transfer = []
    const buffers = frames.map((frame) => {
      const buffer = frame.buffer
      transfer.push(buffer)
      return buffer
    })

    onProgress?.({
      phase: 'encode',
      progress: 0.74,
      label: '正在把颜色收进 256 色的小口袋',
      current: frames.length,
      frames: frames.length,
    })

    worker.postMessage(
      {
        width,
        height,
        buffers,
        delayMs: 1000 / fps,
        quality,
        transparent,
      },
      transfer,
    )

    if (signal) {
      abortTimer = window.setInterval(() => {
        if (signal.aborted && !settled) {
          cleanup()
          reject(abortError())
        }
      }, 120)
    }
  })
}
