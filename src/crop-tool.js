import { clamp, nextFrame } from './utils.js'

const RATIO_PRESETS = [1, 0.75, 0.5625, 1.7778, 1.3333]

/**
 * A dependency-free crop sheet with drag / wheel / pinch support and
 * aspect-aware output. The output is an offscreen canvas, which is exactly
 * what the WebGL texture and the compositor need.
 */
export class CropTool {
  constructor(refs) {
    this.modal = refs.modal
    this.stage = refs.stage
    this.frame = refs.frame
    this.image = refs.image
    this.ratios = refs.ratios
    this.zoomInput = refs.zoomInput
    this.zoomValue = refs.zoomValue
    this.confirmButton = refs.confirmButton
    this.title = refs.title
    this.help = refs.help

    this.resolve = null
    this.objectUrl = ''
    this.naturalWidth = 0
    this.naturalHeight = 0
    this.aspect = 1
    this.baseScale = 1
    this.zoom = 1
    this.offsetX = 0
    this.offsetY = 0
    this.frameWidth = 1
    this.frameHeight = 1
    this.pointers = new Map()
    this.pinch = null
    this.drag = null
    this.loaded = false
    this.isOpen = false

    this.boundFramePointerDown = this.onPointerDown.bind(this)
    this.boundPointerMove = this.onPointerMove.bind(this)
    this.boundPointerUp = this.onPointerUp.bind(this)
    this.boundWheel = this.onWheel.bind(this)
    this.boundResize = this.layout.bind(this)
    this.boundKeydown = this.onKeydown.bind(this)

    this.frame.addEventListener('pointerdown', this.boundFramePointerDown)
    this.frame.addEventListener('wheel', this.boundWheel, { passive: false })
    this.zoomInput.addEventListener('input', () => this.setZoom(Number(this.zoomInput.value)))
    this.ratios.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-ratio]')
      if (!button) return
      this.setAspect(Number(button.dataset.ratio))
    })
    this.confirmButton.addEventListener('click', () => this.confirm())
    this.stage.addEventListener('dblclick', () => this.setZoom(this.zoom > 1.2 ? 1 : 2))

    this.modal.querySelectorAll('[data-close="cropModal"]').forEach((button) => {
      button.addEventListener('click', () => this.cancel())
    })
  }

  async open(file, options = {}) {
    if (!file) return null
    this.closeCleanup()
    this.title.textContent = options.title || '裁剪图片'
    if (this.help) {
      this.help.textContent =
        options.help || '拖动图片调整位置 · 滚轮 / 双指缩放 · 画面会按比例裁切'
    }
    this.aspect = RATIO_PRESETS.includes(Number(options.aspect)) ? Number(options.aspect) : 1
    this.zoom = 1
    this.offsetX = 0
    this.offsetY = 0
    this.pointers.clear()
    this.pinch = null
    this.drag = null
    this.loaded = false
    this.confirmButton.disabled = true

    this.objectUrl = URL.createObjectURL(file)
    this.isOpen = true
    this.modal.classList.add('is-open')
    this.modal.setAttribute('aria-hidden', 'false')
    document.body.classList.add('has-modal')

    try {
      await this.loadImage(this.objectUrl)
      if (!this.isOpen) return null
      this.naturalWidth = this.image.naturalWidth
      this.naturalHeight = this.image.naturalHeight
      if (!this.naturalWidth || !this.naturalHeight) throw new Error('图片尺寸异常')
      this.loaded = true
      this.confirmButton.disabled = false
      this.setAspect(this.aspect, true)
      await nextFrame()
      this.layout()
      this.updateRatioButtons()
      this.zoomInput.value = '1'
      this.updateZoomLabel()
      this.updateZoomFill()
      window.addEventListener('resize', this.boundResize)
      window.addEventListener('keydown', this.boundKeydown)
      this.autoFitInitialZoom()
      return await new Promise((resolve) => {
        this.resolve = resolve
      })
    } catch (error) {
      this.cancel()
      throw error
    }
  }

  loadImage(url) {
    return new Promise((resolve, reject) => {
      this.image.onload = () => resolve()
      this.image.onerror = () => reject(new Error('图片读取失败，请换一张试试'))
      this.image.src = url
    })
  }

  setAspect(aspect, silent = false) {
    if (!Number.isFinite(aspect) || aspect <= 0) return
    this.aspect = aspect
    if (!silent) {
      this.zoom = 1
      this.offsetX = 0
      this.offsetY = 0
      this.zoomInput.value = '1'
      this.updateZoomLabel()
    }
    this.updateRatioButtons()
    this.layout()
  }

  autoFitInitialZoom() {
    // Slight over-zoom for very wide images so the subject is not tiny.
    const ratio = this.naturalWidth / this.naturalHeight
    if (ratio > 1.9) this.setZoom(1.08)
    if (ratio < 0.52) this.setZoom(1.08)
  }

  updateRatioButtons() {
    this.ratios.querySelectorAll('button[data-ratio]').forEach((button) => {
      const active = Math.abs(Number(button.dataset.ratio) - this.aspect) < 0.01
      button.classList.toggle('is-active', active)
    })
  }

  layout() {
    if (!this.isOpen) return
    const rect = this.stage.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const maxW = Math.max(80, rect.width - 54)
    const maxH = Math.max(80, rect.height - 54)
    let width = maxW
    let height = width / this.aspect
    if (height > maxH) {
      height = maxH
      width = height * this.aspect
    }
    this.frameWidth = Math.round(width)
    this.frameHeight = Math.round(height)
    this.frame.style.width = `${this.frameWidth}px`
    this.frame.style.height = `${this.frameHeight}px`

    if (!this.loaded) return
    this.baseScale = Math.max(
      this.frameWidth / this.naturalWidth,
      this.frameHeight / this.naturalHeight,
    )
    this.clampOffsets()
    this.renderImage()
  }

  renderImage() {
    if (!this.loaded) return
    const scale = this.baseScale * this.zoom
    const displayWidth = this.naturalWidth * scale
    const displayHeight = this.naturalHeight * scale
    const left = (this.frameWidth - displayWidth) / 2 + this.offsetX
    const top = (this.frameHeight - displayHeight) / 2 + this.offsetY
    this.image.style.width = `${displayWidth}px`
    this.image.style.height = `${displayHeight}px`
    this.image.style.left = `${left}px`
    this.image.style.top = `${top}px`
  }

  clampOffsets() {
    const scale = this.baseScale * this.zoom
    const displayWidth = this.naturalWidth * scale
    const displayHeight = this.naturalHeight * scale
    const maxX = Math.max(0, (displayWidth - this.frameWidth) / 2)
    const maxY = Math.max(0, (displayHeight - this.frameHeight) / 2)
    this.offsetX = clamp(this.offsetX, -maxX, maxX)
    this.offsetY = clamp(this.offsetY, -maxY, maxY)
  }

  setZoom(value) {
    if (!this.loaded) return
    const next = clamp(Number(value) || 1, 1, 4)
    const old = this.zoom
    if (Math.abs(next - old) < 0.0001) return
    // zoom towards the crop centre, which feels natural for a fixed frame
    const scaleBefore = this.baseScale * old
    const scaleAfter = this.baseScale * next
    const cx = -this.offsetX / scaleBefore
    const cy = -this.offsetY / scaleBefore
    this.zoom = next
    this.offsetX = -cx * scaleAfter
    this.offsetY = -cy * scaleAfter
    this.zoomInput.value = String(next)
    this.updateZoomLabel()
    this.updateZoomFill()
    this.clampOffsets()
    this.renderImage()
  }

  updateZoomLabel() {
    this.zoomValue.textContent = `${this.zoom.toFixed(1)}×`
  }

  updateZoomFill() {
    const min = Number(this.zoomInput.min) || 1
    const max = Number(this.zoomInput.max) || 4
    const percent = ((this.zoom - min) / (max - min)) * 100
    this.zoomInput.style.setProperty('--fill', `${Math.max(0, Math.min(100, percent))}%`)
  }

  onPointerDown(event) {
    if (!this.loaded) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    this.frame.setPointerCapture?.(event.pointerId)
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.pointers.size === 1) {
      this.drag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        baseX: this.offsetX,
        baseY: this.offsetY,
      }
      this.pinch = null
    } else if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values())
      this.pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: this.zoom,
      }
      this.drag = null
    }

    window.addEventListener('pointermove', this.boundPointerMove, { passive: false })
    window.addEventListener('pointerup', this.boundPointerUp)
    window.addEventListener('pointercancel', this.boundPointerUp)
  }

  onPointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return
    event.preventDefault()
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = Array.from(this.pointers.values())
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinch.distance > 0) {
        this.setZoom(this.pinch.zoom * (distance / this.pinch.distance))
      }
      return
    }

    if (this.drag && this.drag.id === event.pointerId) {
      this.offsetX = this.drag.baseX + (event.clientX - this.drag.startX)
      this.offsetY = this.drag.baseY + (event.clientY - this.drag.startY)
      this.clampOffsets()
      this.renderImage()
    }
  }

  onPointerUp(event) {
    this.pointers.delete(event.pointerId)
    if (this.pointers.size === 0) {
      this.drag = null
      this.pinch = null
      window.removeEventListener('pointermove', this.boundPointerMove)
      window.removeEventListener('pointerup', this.boundPointerUp)
      window.removeEventListener('pointercancel', this.boundPointerUp)
    } else if (this.pointers.size === 1) {
      const remaining = Array.from(this.pointers.entries())[0]
      this.drag = {
        id: remaining[0],
        startX: remaining[1].x,
        startY: remaining[1].y,
        baseX: this.offsetX,
        baseY: this.offsetY,
      }
      this.pinch = null
    }
  }

  onWheel(event) {
    if (!this.loaded) return
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.0014)
    this.setZoom(this.zoom * factor)
  }

  onKeydown(event) {
    if (!this.isOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancel()
    }
  }

  confirm() {
    if (!this.loaded || !this.resolve) return
    const scale = this.baseScale * this.zoom
    const displayWidth = this.naturalWidth * scale
    const displayHeight = this.naturalHeight * scale
    const left = (this.frameWidth - displayWidth) / 2 + this.offsetX
    const top = (this.frameHeight - displayHeight) / 2 + this.offsetY

    const sw = clamp(this.frameWidth / scale, 1, this.naturalWidth)
    const sh = clamp(this.frameHeight / scale, 1, this.naturalHeight)
    const sx = clamp(-left / scale, 0, Math.max(0, this.naturalWidth - sw))
    const sy = clamp(-top / scale, 0, Math.max(0, this.naturalHeight - sh))

    const maxOutput = 1600
    const outWidth = Math.max(1, Math.round(Math.min(sw, maxOutput)))
    const outHeight = Math.max(1, Math.round((outWidth * sh) / sw))
    const canvas = document.createElement('canvas')
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.image, sx, sy, sw, sh, 0, 0, outWidth, outHeight)

    const resolve = this.resolve
    this.resolve = null
    this.shutdown()
    resolve(canvas)
  }

  cancel() {
    if (!this.isOpen) return
    const resolve = this.resolve
    this.resolve = null
    this.shutdown()
    if (resolve) resolve(null)
  }

  shutdown() {
    this.isOpen = false
    this.modal.classList.remove('is-open')
    this.modal.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('has-modal')
    window.removeEventListener('resize', this.boundResize)
    window.removeEventListener('keydown', this.boundKeydown)
    window.removeEventListener('pointermove', this.boundPointerMove)
    window.removeEventListener('pointerup', this.boundPointerUp)
    window.removeEventListener('pointercancel', this.boundPointerUp)
    this.pointers.clear()
    this.pinch = null
    this.drag = null
    this.loaded = false
    this.closeCleanup()
  }

  closeCleanup() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = ''
    }
    this.image.removeAttribute('src')
  }
}
