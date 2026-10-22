/**
 * A very small, framework-free helper set for the Toy.
 * Keeping these local avoids shipping a utility bundle we do not need.
 */

export const $ = (selector, root = document) => root.querySelector(selector)
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector))

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const lerp = (a, b, t) => a + (b - a) * t

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function debounce(fn, wait = 160) {
  let timer = 0
  return (...args) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => fn(...args), wait)
  }
}

export function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败，请换一张试试'))
    if (source instanceof Blob) {
      const url = URL.createObjectURL(source)
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('图片解码失败，请换一张试试'))
      }
      img.src = url
    } else {
      img.src = source
    }
  })
}

export function validateImageFile(file) {
  if (!file) return '没有选择图片'
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)) {
    return '请选择 PNG、JPG、WebP 等图片文件'
  }
  if (file.size > 28 * 1024 * 1024) return '图片太大了，请控制在 28MB 以内'
  return ''
}

export function trimTransparentCanvas(canvas, threshold = 8, padding = 2) {
  if (!canvas?.width || !canvas?.height) return canvas
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return canvas
  let imageData
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  } catch {
    return canvas
  }
  const { data, width, height } = imageData
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let anyTransparent = false
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha <= threshold) {
        anyTransparent = true
      } else {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (!anyTransparent || maxX < minX || maxY < minY) return canvas
  const area = (maxX - minX + 1) * (maxY - minY + 1)
  if (area >= canvas.width * canvas.height * 0.985) return canvas
  const left = Math.max(0, minX - padding)
  const top = Math.max(0, minY - padding)
  const right = Math.min(width - 1, maxX + padding)
  const bottom = Math.min(height - 1, maxY + padding)
  const out = document.createElement('canvas')
  out.width = right - left + 1
  out.height = bottom - top + 1
  const outCtx = out.getContext('2d')
  outCtx.imageSmoothingQuality = 'high'
  outCtx.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))), type, quality)
  })
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(blob)
  })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return new Promise((resolve, reject) => {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('复制失败'))
    } catch (error) {
      reject(error)
    } finally {
      area.remove()
    }
  })
}

export function getStoredJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function setStoredJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage may be unavailable in privacy mode */
  }
}

export function removeStored(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function isLocalPreview() {
  if (location.protocol === 'file:') return true
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
}

export function stringHash(value) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}
