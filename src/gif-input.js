/**
 * GIF 输入支持。
 *
 * 用 gifuct-js 做纯 JS 的 GIF 解码（不依赖浏览器的 ImageDecoder / WebCodecs，
 * 后者对 GIF 动画的支持长期残缺，会拿不到帧数或 decode 抛错导致静默回退）。
 * 解码后按 GIF 的 disposal 语义逐帧合成完整画布，预览和导出共用同一条时间轴。
 */

import { parseGIF, decompressFrames } from 'gifuct-js'

// 动图直接当主角贴图，超过这个分辨率收益不大，反而很吃内存。
const MAX_EDGE = 512
const MAX_FRAMES = 120

export function isGifFile(file) {
  if (!file) return false
  return file.type === 'image/gif' || /\.gif$/i.test(file.name || '')
}

export async function decodeGifFrames(file) {
  try {
    const buffer = await file.arrayBuffer()
    const gif = parseGIF(buffer)
    const raw = decompressFrames(gif, true)
    if (!raw?.length || !gif?.lsd) return null

    const total = raw.length
    const frameCount = Math.min(total, MAX_FRAMES)
    const srcWidth = gif.lsd.width
    const srcHeight = gif.lsd.height

    // 累积画布用原始逻辑屏幕尺寸：GIF 每帧的 patch 坐标都是相对它的。
    const compose = document.createElement('canvas')
    compose.width = srcWidth
    compose.height = srcHeight
    const cctx = compose.getContext('2d')

    // 输出帧统一缩到 MAX_EDGE 内，控制内存；首帧 PNG 也用同一尺寸，裁剪坐标才能对齐。
    const scale = Math.min(1, MAX_EDGE / Math.max(srcWidth, srcHeight, 1))
    const outWidth = Math.max(1, Math.round(srcWidth * scale))
    const outHeight = Math.max(1, Math.round(srcHeight * scale))

    // 预计算需要输出的源帧索引（均匀采样）。
    const pick = new Set()
    for (let i = 0; i < frameCount; i += 1) {
      pick.add(total > frameCount ? Math.floor((i * total) / frameCount) : i)
    }

    const patchCanvas = document.createElement('canvas')
    const patchCtx = patchCanvas.getContext('2d')

    const frames = []
    const starts = []
    let clock = 0

    // 必须连续遍历所有源帧来维护累积画布（disposal 是帧间的状态转移，跳帧会画错）。
    for (let i = 0; i < total; i += 1) {
      const frame = raw[i]
      const dims = frame.dims

      // 为 disposal 3（显示后恢复到本帧之前的画面）预留快照。
      let beforeSnapshot = null
      if (frame.disposalType === 3) {
        beforeSnapshot = cctx.getImageData(0, 0, srcWidth, srcHeight)
      }

      // 把本帧 patch 贴到累积画布对应位置。透明像素 alpha=0，source-over 下不会覆盖旧内容。
      patchCanvas.width = dims.width
      patchCanvas.height = dims.height
      patchCtx.putImageData(new ImageData(frame.patch, dims.width, dims.height), 0, 0)
      cctx.drawImage(patchCanvas, dims.left, dims.top)

      const delayMs = Number(frame.delay) || 0
      const delaySec = delayMs >= 4 ? delayMs / 1000 : 0.1

      // 采样：只保留被选中的帧画布与时间点。
      if (pick.has(i)) {
        const out = document.createElement('canvas')
        out.width = outWidth
        out.height = outHeight
        out.getContext('2d').drawImage(compose, 0, 0, outWidth, outHeight)
        frames.push(out)
        starts.push(clock)
      }

      clock += delaySec

      // 处理 disposal，为下一帧准备画布。
      if (frame.disposalType === 2) {
        cctx.clearRect(dims.left, dims.top, dims.width, dims.height)
      } else if (frame.disposalType === 3 && beforeSnapshot) {
        cctx.putImageData(beforeSnapshot, 0, 0)
      }
    }

    if (!frames.length) return null

    return {
      frames,
      starts,
      duration: clock,
      width: outWidth,
      height: outHeight,
      trimmed: total > frameCount,
    }
  } catch (error) {
    console.warn('[Q弹] GIF 逐帧解码失败，回退到首帧', error)
    return null
  }
}

/**
 * 用裁剪工具算出的「源图矩形」把每一帧裁成同样大小。
 *
 * 注意：贴图源画布必须是独立的一份拷贝，否则播放回第 0 帧时会被后面的帧
 * 覆盖（frames[0] 和贴图画布是同一个对象就会出这个 bug）。
 */
export async function cropGifFrames(decoded, rect) {
  const { frames, starts, duration } = decoded || {}
  if (!frames?.length || !rect) return null

  const longEdge = Math.max(rect.outWidth, rect.outHeight, 1)
  const scale = Math.min(1, MAX_EDGE / longEdge)
  const outWidth = Math.max(1, Math.round(rect.outWidth * scale))
  const outHeight = Math.max(1, Math.round(rect.outHeight * scale))

  const cropped = []
  for (const frame of frames) {
    const canvas = document.createElement('canvas')
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(frame, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outWidth, outHeight)
    cropped.push(canvas)
  }

  const textureCanvas = document.createElement('canvas')
  textureCanvas.width = outWidth
  textureCanvas.height = outHeight
  textureCanvas.getContext('2d').drawImage(cropped[0], 0, 0)

  return { frames: cropped, starts, duration, textureCanvas }
}
