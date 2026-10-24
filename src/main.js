import './styles.css'
import {
  $,
  $$,
  blobToDataURL,
  clamp,
  copyText,
  debounce,
  downloadBlob,
  formatBytes,
  getStoredJSON,
  nextFrame,
  setStoredJSON,
  trimTransparentCanvas,
  validateImageFile,
} from './utils.js'
import { CropTool } from './crop-tool.js'
import { createDemoPlushCanvas } from './demo-art.js'
import { cropGifFrames, decodeGifFrames, isGifFile } from './gif-input.js'
import { QStage } from './scene.js'
import { loadModelFiles } from './model-loader.js'
import { exportGif } from './gif-export.js'
import { ToyBridge } from './toy-bridge.js'
import { QuotaStore } from './quota.js'
import { MusicController } from './music.js'

const SETTINGS_KEY = 'qtan_settings_v2'
const DEFAULT_SETTINGS = {
  mode: 'image',
  aspect: 1,
  bounce: 100,
  squash: 100,
  speed: 2,
  sway: 0,
  jelly: 0,
  shadow: true,
  spin: true,
  spinSpeed: 1,
  loopDuration: 2,
  fps: 25,
  size: 480,
  quality: 256,
  background: 'transparent',
}

const RATIO_LABELS = {
  1: '1:1',
  0.75: '3:4',
  0.5625: '9:16',
  1.7778: '16:9',
  1.3333: '4:3',
}

const app = $('#app')
const bridge = new ToyBridge()
const quota = new QuotaStore(bridge)
let music = null
let stage = null
let cropper = null
let exporting = false
let exportSignal = null
let currentResult = null
let lastImageFile = null
let lastImageCanvas = null
let currentModel = null
let authorMid = 0
let followBusy = false
let cloudBusy = false
let settings = loadSettings()
let dragDepth = 0
let hintTimer = 0
let modelDrag = null
let suppressStageClick = false

document.body.classList.toggle('is-local-preview', bridge.localPreview)
if (bridge.localPreview) {
  const badge = $('#envBadge')
  badge.hidden = false
  badge.textContent = bridge.hasSdk ? '本地预览 · SDK' : '本地预览 · 云端模拟'
}

quota.subscribe(renderQuota)

function loadSettings() {
  const saved = getStoredJSON(SETTINGS_KEY, {}) || {}
  const merged = { ...DEFAULT_SETTINGS }
  const ratios = Object.keys(RATIO_LABELS).map(Number)
  if (['image', 'model'].includes(saved.mode)) merged.mode = saved.mode
  if (ratios.includes(Number(saved.aspect))) merged.aspect = Number(saved.aspect)
  for (const key of ['bounce', 'squash', 'speed', 'sway', 'jelly']) {
    const value = Number(saved[key])
    if (Number.isFinite(value)) merged[key] = value
  }
  if (typeof saved.shadow === 'boolean') merged.shadow = saved.shadow
  if (typeof saved.spin === 'boolean') merged.spin = saved.spin
  if (Number.isFinite(Number(saved.spinSpeed))) merged.spinSpeed = Number(saved.spinSpeed)
  if ([1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].includes(Number(saved.loopDuration))) {
    merged.loopDuration = Number(saved.loopDuration)
  }
  if ([15, 20, 25, 30, 50].includes(Number(saved.fps))) merged.fps = Number(saved.fps)
  if ([360, 480, 600, 720].includes(Number(saved.size))) merged.size = Number(saved.size)
  if ([128, 256].includes(Number(saved.quality))) merged.quality = Number(saved.quality)
  if (['white', 'transparent'].includes(saved.background)) merged.background = saved.background
  // Background images are intentionally session-only for privacy; never store
  // a user's file in localStorage.
  if (saved.background === 'image') merged.background = 'transparent'
  merged.speed = clamp(merged.speed, 2, 6)
  merged.bounce = clamp(merged.bounce, 0, 300)
  merged.squash = clamp(merged.squash, 0, 300)
  merged.sway = clamp(merged.sway, 0, 300)
  merged.jelly = clamp(merged.jelly, 0, 300)
  merged.spinSpeed = clamp(Math.round(merged.spinSpeed || 1), 1, 6)
  return merged
}

const saveSettings = debounce(() => {
  setStoredJSON(SETTINGS_KEY, settings)
}, 220)

function init() {
  setupStage()
  setupCropTool()
  setupMusic()
  bindSourceControls()
  bindSettings()
  bindStageControls()
  bindBackgroundControls()
  bindExportControls()
  bindResultControls()
  bindQuotaControls()
  bindFollowControls()
  bindModals()
  bindHelp()
  bindDragAndDrop()
  bindViewport()
  applySettingsToUI()
  applySettingsToStage()
  layoutStage()
  setTimeout(layoutStage, 60)
  setTimeout(layoutStage, 300)
  document.fonts?.ready?.then(() => layoutStage()).catch(() => {})

  stage.start()
  quota.init().catch((error) => console.warn('[Q弹] 云存档初始化失败', error))
  syncContainerState()
  hintTimer = window.setTimeout(() => {
    if (!stage.hasImage()) $('#stageHint').classList.add('is-hidden')
  }, 12000)

  window.addEventListener('pagehide', () => quota.flush())
  window.addEventListener('beforeunload', () => quota.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) quota.flush()
  })

  window.addEventListener('resize', () => {
    layoutStage()
  })

  // Expose a tiny debug surface for local QA; it contains no account data.
  window.__QTAN__ = {
    getState: () => ({
      settings: { ...settings },
      quota: quota.snapshot(),
      mode: stage?.mode,
      hasModel: stage?.hasRealModel(),
      hasImage: stage?.hasImage(),
    }),
    resetQuota: () => quota.resetLocal(),
  }
}

function setupStage() {
  stage = new QStage({
    canvas: $('#stageCanvas'),
    frame: $('#stageFrame'),
    onStatus: (message) => console.log('[Q弹]', message),
  })
  const demo = trimTransparentCanvas(createDemoPlushCanvas(760))
  stage.setImage(demo)
  stage.setMode(settings.mode)
  stage.setBackgroundMode(settings.background)
  const frame = $('#stageFrame')
  frame.dataset.bg = settings.background
  frame.classList.toggle('has-bg', settings.background === 'image')
  updateBackgroundChip()
  updateSourceLabels()
}

function setupCropTool() {
  cropper = new CropTool({
    modal: $('#cropModal'),
    stage: $('#cropStage'),
    frame: $('#cropFrame'),
    image: $('#cropImage'),
    ratios: $('#cropRatios'),
    zoomInput: $('#cropZoom'),
    zoomValue: $('#cropZoomValue'),
    confirmButton: $('#cropConfirm'),
    title: $('#cropTitle'),
    help: $('.crop-help'),
  })
}

function setupMusic() {
  music = new MusicController({
    audio: $('#bgm'),
    video: $('#bgVideo'),
    app,
    els: {
      musicButton: $('#musicButton'),
      musicPanel: $('#musicPanel'),
      musicStateNote: $('#musicStateNote'),
      closeMusic: $('#closeMusic'),
      panelPlayButton: $('#panelPlayButton'),
      playButton: $('#panelPlayButton'),
      muteButton: $('#muteButton'),
      seekRange: $('#seekRange'),
      volumeRange: $('#volumeRange'),
      volumeValue: $('#volumeValue'),
      currentTime: $('#currentTime'),
      totalTime: $('#totalTime'),
      videoToggle: $('#videoToggle'),
      videoToggleInPanel: $('#videoToggleInPanel'),
      audioStatusText: $('#audioStatusText'),
      audioStatusDot: $('#audioStatusDot'),
    },
  })
  music.init().catch(() => {})
}

function bindSourceControls() {
  const imageInput = $('#imageInput')
  const modelInput = $('#modelInput')

  const openImagePicker = () => imageInput.click()
  const openModelPicker = () => modelInput.click()

  $('#imageDrop').addEventListener('click', openImagePicker)
  $('#imageDrop').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openImagePicker()
    }
  })
  $('#modelDrop').addEventListener('click', openModelPicker)
  $('#modelDrop').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openModelPicker()
    }
  })

  imageInput.addEventListener('change', () => {
    const file = imageInput.files?.[0]
    imageInput.value = ''
    if (file) importImage(file)
  })
  modelInput.addEventListener('change', () => {
    const files = Array.from(modelInput.files || [])
    modelInput.value = ''
    if (files.length) importModel(files)
  })

  $('#replaceImage').addEventListener('click', openImagePicker)
  $('#recropImage').addEventListener('click', async () => {
    if (!lastImageFile) {
      openImagePicker()
      return
    }
    await importImage(lastImageFile, { isRecrop: true })
  })
  $('#replaceModel').addEventListener('click', openModelPicker)
  $('#modelAnimSelect').addEventListener('change', () => {
    const index = Number($('#modelAnimSelect').value)
    if (!Number.isInteger(index)) return
    stage.playModelAnimation(index)
    stage.pulse()
  })
  $('#modelAnimToggle').addEventListener('click', () => {
    const button = $('#modelAnimToggle')
    const nowPlaying = button.classList.contains('is-paused') // 之前暂停 → 现在播放
    setAnimToggleState(button, nowPlaying)
    stage.setModelAnimPlaying(nowPlaying)
  })
  $('#gifAnimToggle').addEventListener('click', () => {
    const button = $('#gifAnimToggle')
    const nowPlaying = button.classList.contains('is-paused')
    setAnimToggleState(button, nowPlaying)
    stage.setGifPlaying(nowPlaying)
  })

  $$('.mode-tab').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode))
  })

  // clicking on the backdrop of the crop stage is handled inside CropTool
  $('#imageDrop').addEventListener('dragover', (event) => {
    event.preventDefault()
    event.currentTarget.classList.add('is-drag')
  })
  $('#imageDrop').addEventListener('dragleave', (event) => {
    event.currentTarget.classList.remove('is-drag')
  })
  $('#imageDrop').addEventListener('drop', (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.remove('is-drag')
    const file = Array.from(event.dataTransfer?.files || []).find((item) => isImageFile(item))
    if (file) importImage(file)
  })
  $('#modelDrop').addEventListener('dragover', (event) => {
    event.preventDefault()
    event.currentTarget.classList.add('is-drag')
  })
  $('#modelDrop').addEventListener('dragleave', (event) => {
    event.currentTarget.classList.remove('is-drag')
  })
  $('#modelDrop').addEventListener('drop', (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.remove('is-drag')
    const files = Array.from(event.dataTransfer?.files || [])
    if (files.length) importModel(files)
  })
}

async function bitmapToPngFile(bitmap) {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  return new File([blob], 'gif-first-frame.png', { type: 'image/png' })
}

async function importImage(file, { isRecrop = false } = {}) {
  if (exporting) return
  const error = validateImageFile(file)
  if (error) {
    toast(error, 'error')
    return
  }
  try {
    // GIF 先整段解码；环境不支持 ImageDecoder 时返回 null，退回静态首帧。
    const gif = isGifFile(file) ? await decodeGifFrames(file) : null
    // 裁剪界面用首帧的静态 PNG，避免 <img> 自己播放时截到随机帧。
    const cropSource = gif ? await bitmapToPngFile(gif.frames[0]) : file
    const canvas = await cropper.open(cropSource, {
      aspect: 1,
      title: isRecrop ? '重新裁一下图片' : '裁剪你的主角',
      help: isRecrop
        ? '重新调整位置和缩放 · 裁好后会立刻更新预览'
        : '拖动图片调整位置 · 滚轮 / 双指缩放 · 建议把主体放在中间',
    })
    if (!canvas) return

    let displayCanvas
    let animated = null
    if (gif && cropper.lastCrop) {
      animated = await cropGifFrames(gif, cropper.lastCrop)
    }

    if (animated) {
      displayCanvas = animated.textureCanvas
      stage.setImageAnimation(animated.frames, animated.starts, animated.duration, displayCanvas)
    } else {
      displayCanvas = trimTransparentCanvas(canvas)
      stage.setImage(displayCanvas)
    }

    // GIF 动图才显示播放开关；静态图隐藏并重置状态。
    $('#gifAnimRow').hidden = !animated
    setAnimToggleState($('#gifAnimToggle'), true)
    stage.setGifPlaying(true)

    lastImageFile = file
    lastImageCanvas = displayCanvas
    setMode('image')
    $('#imageDrop').hidden = true
    $('#imageAsset').hidden = false
    $('#imageThumb').src = makeThumbnail(displayCanvas)
    $('#imageName').textContent = file.name || '我的图片'
    $('#imageSize').textContent = animated
      ? `${displayCanvas.width} × ${displayCanvas.height} · ${animated.frames.length} 帧动图`
      : `${displayCanvas.width} × ${displayCanvas.height} · 已裁剪`
    updateSourceLabels(file.name || '我的图片')
    $('#stageHint').classList.add('is-hidden')
    stage.pulse()
    toast(
      animated
        ? `动图接好了，${animated.frames.length} 帧会跟着一起 Q 弹`
        : '图片放好啦，已经 Q 起来',
      'success',
    )
  } catch (error) {
    console.error(error)
    toast(error.message || '图片处理失败', 'error')
  }
}

async function importModel(files) {
  if (exporting) return
  const list = Array.from(files || []).filter(Boolean)
  if (!list.length) return
  if (list.some((file) => file.size > 160 * 1024 * 1024)) {
    toast('模型文件有点大，建议控制在 160MB 以内', 'warn')
  }
  setMode('model')
  showStageLoading(true, '正在载入 3D 模型…', '模型会边载入边 Q 弹')
  $('#stageHint').classList.add('is-hidden')
  try {
    const result = await loadModelFiles(list, {
      onProgress: (label) => {
        $('#stageLoadingSub').textContent = label || '正在读取模型…'
      },
    })
    stage.setModel(result)
    currentModel = result
    $('#modelDrop').hidden = true
    $('#modelAsset').hidden = false
    $('#modelName').textContent = result.meta.name
    const pieces = [result.meta.format, result.meta.sizeLabel]
    if (result.meta.triangles) pieces.push(`${formatCount(result.meta.triangles)} 面`)
    if (result.meta.animationCount) pieces.push(`${result.meta.animationCount} 段动作`)
    $('#modelSize').textContent = pieces.join(' · ')
    setupAnimSelect(result)
    updateSourceLabels(result.meta.name)
    stage.pulse()
    toast(`${result.meta.format} 模型载入成功，开始 Q 弹`, 'success')
  } catch (error) {
    console.error(error)
    toast(error.message || '模型载入失败，请换个格式试试', 'error')
  } finally {
    showStageLoading(false)
  }
}

function showStageLoading(show, title, sub) {
  const el = $('#stageLoading')
  el.hidden = !show
  if (title) $('#stageLoadingTitle').textContent = title
  if (sub) $('#stageLoadingSub').textContent = sub
}

function setupAnimSelect(result) {
  const row = $('#modelAnimRow')
  const select = $('#modelAnimSelect')
  const selectLabel = $('#modelAnimSelectLabel')
  const toggle = $('#modelAnimToggle')
  const animations = result?.animations || []

  if (animations.length) {
    row.hidden = false
    setAnimToggleState(toggle, true)
    stage.setModelAnimPlaying(true)
    // 多段动作才需要下拉框；单段动作直接自动播第一段，只留播放开关。
    if (animations.length > 1) {
      select.innerHTML = ''
      animations.forEach((clip, index) => {
        const option = document.createElement('option')
        option.value = String(index)
        option.textContent = clip.name || `动作 ${index + 1}`
        select.appendChild(option)
      })
      select.value = '0'
      select.hidden = false
      selectLabel.hidden = false
    } else {
      select.innerHTML = ''
      select.hidden = true
      selectLabel.hidden = true
    }
  } else {
    select.innerHTML = ''
    row.hidden = true
  }
}

function setAnimToggleState(button, playing) {
  if (!button) return
  const paused = !playing
  button.classList.toggle('is-paused', paused)
  button.setAttribute('aria-pressed', String(playing))
  const label = button.querySelector('span')
  if (label) {
    const base = button.id === 'gifAnimToggle' ? '动图' : '动作'
    label.textContent = paused ? `播放${base}` : `暂停${base}`
  }
}

function setMode(mode, { silentStage = false } = {}) {
  if (!['image', 'model'].includes(mode)) return
  settings.mode = mode
  saveSettings()
  $('#imageSection').hidden = mode !== 'image'
  $('#modelSection').hidden = mode !== 'model'
  $('.panel--source').dataset.mode = mode
  $('.mode-tabs').dataset.active = mode
  $$('.mode-tab').forEach((button) => {
    const active = button.dataset.mode === mode
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-selected', String(active))
  })
  if (!silentStage) stage.setMode(mode)
  updateSourceLabels()
  $('#stageFrame').dataset.mode = mode
  updateStageHint()
}

function updateStageHint() {
  const hint = $('#stageHint')
  hint.innerHTML =
    settings.mode === 'model'
      ? '<svg class="icon"><use href="#i-rotate" /></svg> 左右拖动 360° · 点一下 Q 弹'
      : '<svg class="icon"><use href="#i-sparkle" /></svg> 点一下画面，Q 一下'
}

function bindSettings() {
  const rangeBindings = [
    ['#bounceRange', '#bounceValue', 'bounce', (value) => String(value)],
    ['#squashRange', '#squashValue', 'squash', (value) => String(value)],
    ['#speedRange', '#speedValue', 'speed', (value) => `${Number(value).toFixed(1)}×`],
    ['#swayRange', '#swayValue', 'sway', (value) => String(value)],
    ['#jellyRange', '#jellyValue', 'jelly', (value) => String(value)],
    ['#spinSpeedRange', '#spinSpeedValue', 'spinSpeed', (value) => `${value} 圈/循环`],
  ]

  for (const [inputSelector, outputSelector, key, format] of rangeBindings) {
    const input = $(inputSelector)
    const output = $(outputSelector)
    input.addEventListener('input', () => {
      settings[key] = Number(input.value)
      output.textContent = format(input.value)
      paintRange(input)
      stage.applyOptions(settings)
      updateLoopMeta()
      saveSettings()
    })
    paintRange(input)
  }

  $('#shadowToggle').addEventListener('change', (event) => {
    settings.shadow = event.target.checked
    stage.applyOptions(settings)
    saveSettings()
  })
  $('#spinToggle').addEventListener('change', (event) => {
    settings.spin = event.target.checked
    stage.applyOptions(settings)
    saveSettings()
  })
  $('#resetSettings').addEventListener('click', () => {
    settings.bounce = DEFAULT_SETTINGS.bounce
    settings.squash = DEFAULT_SETTINGS.squash
    settings.speed = DEFAULT_SETTINGS.speed
    settings.sway = DEFAULT_SETTINGS.sway
    settings.jelly = DEFAULT_SETTINGS.jelly
    settings.shadow = DEFAULT_SETTINGS.shadow
    settings.spin = DEFAULT_SETTINGS.spin
    settings.spinSpeed = DEFAULT_SETTINGS.spinSpeed
    applySettingsToUI()
    stage.applyOptions(settings)
    updateLoopMeta()
    saveSettings()
    stage.pulse()
    toast('手感已经恢复默认啦', 'success')
  })
}

function bindStageControls() {
  $$('#aspectSwitch button').forEach((button) => {
    button.addEventListener('click', () => {
      settings.aspect = Number(button.dataset.aspect)
      $$('#aspectSwitch button').forEach((item) =>
        item.classList.toggle('is-active', item === button),
      )
      stage.setAspect(settings.aspect)
      layoutStage()
      updateOutputMeta()
      saveSettings()
    })
  })

  const stageCanvas = $('#stageCanvas')
  stageCanvas.addEventListener('pointerdown', (event) => {
    if (exporting || settings.mode !== 'model') return
    modelDrag = {
      id: event.pointerId,
      x: event.clientX,
      moved: 0,
    }
    stageCanvas.setPointerCapture?.(event.pointerId)
    $('#stageFrame').classList.add('is-rotating')
  })
  stageCanvas.addEventListener('pointermove', (event) => {
    if (!modelDrag || modelDrag.id !== event.pointerId) return
    const dx = event.clientX - modelDrag.x
    if (!dx) return
    modelDrag.x = event.clientX
    modelDrag.moved += Math.abs(dx)
    stage.rotateModel(dx * 0.011)
    $('#stageHint').classList.add('is-hidden')
  })
  const finishStageDrag = (event) => {
    if (!modelDrag || (event && modelDrag.id !== event.pointerId)) return
    if (modelDrag.moved > 7) {
      suppressStageClick = true
      window.setTimeout(() => {
        suppressStageClick = false
      }, 80)
    }
    modelDrag = null
    $('#stageFrame').classList.remove('is-rotating')
  }
  stageCanvas.addEventListener('pointerup', finishStageDrag)
  stageCanvas.addEventListener('pointercancel', finishStageDrag)

  stageCanvas.addEventListener('click', () => {
    if (exporting) return
    if (suppressStageClick) {
      suppressStageClick = false
      return
    }
    stage.pulse()
    $('#stageHint').classList.add('is-hidden')
  })
  $('#stageHint').addEventListener('click', () => {
    stage.pulse()
    $('#stageHint').classList.add('is-hidden')
  })

  const selects = [
    ['#sizeSelect', 'size', Number, updateOutputMeta],
    ['#qualitySelect', 'quality', Number, null],
    ['#fpsSelect', 'fps', Number, updateLoopMeta],
    ['#durationSelect', 'loopDuration', Number, updateLoopMeta],
  ]
  for (const [selector, key, cast, after] of selects) {
    $(selector).addEventListener('change', (event) => {
      settings[key] = cast(event.target.value)
      stage.applyOptions(settings)
      if (after) after()
      saveSettings()
    })
  }
}

function bindBackgroundControls() {
  const input = $('#bgInput')
  $$('#bgTabs button').forEach((button) => {
    button.addEventListener('click', async () => {
      const mode = button.dataset.bg
      if (mode === 'image' && !stage.backgroundCanvas) {
        input.value = ''
        input.click()
        return
      }
      settings.background = mode
      stage.setBackgroundMode(mode)
      $('#stageFrame').dataset.bg = mode
      $('#stageFrame').classList.toggle('has-bg', mode === 'image')
      updateBackgroundChip()
      updateBackgroundTabs()
      updateBackgroundNote()
      saveSettings()
    })
  })

  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const error = validateImageFile(file)
    if (error) {
      toast(error, 'error')
      return
    }
    try {
      const canvas = await cropper.open(file, {
        aspect: settings.aspect,
        title: '裁剪背景图片',
        help: '背景会按当前画布比例铺满 · 拖动和缩放找到最好看的部分',
      })
      if (!canvas) return
      stage.setBackgroundImage(canvas)
      settings.background = 'image'
      stage.setBackgroundMode('image')
      $('#stageFrame').dataset.bg = 'image'
      $('#stageFrame').classList.add('has-bg')
      $('#bgThumb').innerHTML = ''
      const thumb = document.createElement('img')
      thumb.alt = ''
      thumb.src = makeThumbnail(canvas)
      $('#bgThumb').appendChild(thumb)
      $('#bgUploadTitle').textContent = file.name
      $('#bgUploadSub').textContent = `${canvas.width} × ${canvas.height} · 点击更换`
      updateBackgroundChip()
      updateBackgroundTabs()
      updateBackgroundNote()
      saveSettings()
      toast('背景铺好啦', 'success')
    } catch (error) {
      console.error(error)
      toast(error.message || '背景图处理失败', 'error')
    }
  })
}

function bindExportControls() {
  $('#exportButton').addEventListener('click', runExport)
  $('#cancelExport').addEventListener('click', () => {
    if (exportSignal && !exportSignal.aborted) {
      exportSignal.aborted = true
      $('#cancelExport').disabled = true
      $('#cancelExport').textContent = '正在取消…'
      $('#progressSub').textContent = '正在把这一帧收尾…'
    }
  })
}

function bindResultControls() {
  $('#downloadGif').addEventListener('click', () => {
    if (!currentResult) return
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .slice(0, 15)
    downloadBlob(currentResult.blob, `qtan-${stamp}.gif`)
    toast('GIF 已经开始下载', 'success')
  })

  $('#saveGif').addEventListener('click', async () => {
    if (!currentResult) return
    const button = $('#saveGif')
    button.disabled = true
    try {
      const dataUrl = await blobToDataURL(currentResult.blob)
      if (dataUrl.length > 5 * 1024 * 1024) {
        toast('GIF 超过相册接口 5MB 限制，请用「下载 GIF」保存', 'warn')
        return
      }
      const saved = await bridge.saveImageToAlbum(dataUrl)
      if (saved.ok) toast('已经保存到相册啦', 'success')
      else if (saved.reason === 'unsupported') toast('当前环境不支持保存到相册，请下载 GIF', 'warn')
      else toast(saved.error?.message || '保存失败，请下载 GIF', 'error')
    } catch (error) {
      toast(error.message || '保存失败，请下载 GIF', 'error')
    } finally {
      button.disabled = false
    }
  })

  $('#shareGif').addEventListener('click', async () => {
    if (bridge.hasSdk) {
      const shared = await bridge.share('index.html')
      if (shared.ok) return
      if (shared.reason === 'unsupported') {
        // Web container: fall through to the browser share sheet.
      } else {
        toast(shared.error?.message || '分享失败，请稍后再试', 'error')
        return
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Q弹动图生成器',
          text: '来揉一张会呼吸的 Q 弹 GIF！',
          url: location.href,
        })
        return
      } catch {
        return
      }
    }
    try {
      await copyText(location.href)
      toast('链接已复制，去分享吧', 'success')
    } catch {
      toast('复制失败，请手动复制地址栏链接', 'warn')
    }
  })

  $('#makeAnother').addEventListener('click', () => {
    closeModal('resultModal')
    $('#stageFrame').scrollIntoView({ behavior: 'smooth', block: 'center' })
    stage.pulse()
  })
}

function bindQuotaControls() {
  $('#cloudButton').addEventListener('click', async () => {
    if (cloudBusy) return
    cloudBusy = true
    const original = $('#cloudLabel').textContent
    $('#cloudLabel').textContent = '同步中'
    try {
      const result = await quota.syncNow()
      if (result.ok) toast('云存档已同步', 'success')
      else if (result.reason === 'local') toast('本地预览模式，云端功能未连接', 'warn')
      else toast('同步失败，请稍后再试', 'warn')
    } finally {
      cloudBusy = false
      if (!$('#cloudLabel').textContent || $('#cloudLabel').textContent === '同步中') {
        $('#cloudLabel').textContent = original
      }
    }
  })
}

function bindFollowControls() {
  $('#claimUnlimited').addEventListener('click', () => checkFollowAndUnlock(false))
  $('#recheckFollow').addEventListener('click', () => checkFollowAndUnlock(true))
  $('#goFollow').addEventListener('click', async () => {
    if (!authorMid) await resolveAuthorMid()
    if (!authorMid) {
      toast('暂时拿不到作者空间地址，请在 B站 搜索 UP 主并关注', 'warn')
      return
    }
    const result = await bridge.openAuthorSpace(authorMid)
    if (!result.ok) {
      toast('打开作者空间失败，请在 B站 搜索 UP 主并关注', 'warn')
    }
  })
}

async function checkFollowAndUnlock(fromModal = false) {
  if (followBusy || quota.infinite) return
  followBusy = true
  setFollowBusy(true)

  try {
    if (bridge.localPreview) {
      quota.unlockInfinite()
      closeModal('followModal')
      toast('本地预览：已模拟解锁无限次数', 'success')
      stage.pulse()
      return
    }

    const relation = await bridge.getAuthorRelation()
    if (!relation.ok) {
      if (relation.reason === 'unsupported') {
        toast('当前容器不支持关注关系校验，请在 B站 App 内打开', 'warn')
      } else {
        toast(relation.error?.message || '关注关系校验失败，请稍后再试', 'warn')
      }
      return
    }

    if (relation.following) {
      quota.unlockInfinite()
      closeModal('followModal')
      toast('关注成功，无限生成次数已解锁', 'success')
      stage.pulse()
      return
    }

    if (!fromModal) {
      await resolveAuthorMid()
      openModal('followModal')
    } else {
      toast('还没有检测到关注，关注后等几秒再点一次', 'warn')
    }
  } finally {
    followBusy = false
    setFollowBusy(false)
  }
}

function setFollowBusy(busy) {
  $('#claimUnlimited').disabled = busy
  $('#recheckFollow').disabled = busy
  $('#goFollow').disabled = busy
  $('#claimUnlimited span').textContent = busy ? '正在校验关注关系…' : '关注并领取无限次数'
}

async function resolveAuthorMid() {
  if (authorMid) return authorMid
  const profile = await bridge.getAuthorProfile()
  if (profile?.mid) authorMid = profile.mid
  if (authorMid) {
    $('#goFollow').hidden = false
    $('#goFollow').disabled = false
  } else {
    $('#goFollow').hidden = true
    $('#followCopy').textContent =
      '暂时拿不到作者空间地址。请在 B站 搜索并关注当前 Toy 的 UP 主，然后回到这里点「我已经关注了」。关注关系会通过 B站官方接口校验。'
  }
  return authorMid
}

function bindModals() {
  $$('[data-close]').forEach((button) => {
    const id = button.dataset.close
    if (id === 'cropModal') return
    button.addEventListener('click', () => closeModal(id))
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    for (const id of ['resultModal', 'followModal', 'helpModal']) {
      if ($(`#${id}`).classList.contains('is-open')) {
        closeModal(id)
        return
      }
    }
  })
}

function openModal(id) {
  const modal = $(`#${id}`)
  if (!modal) return
  modal.dataset.previousFocus = String(document.activeElement?.id || '')
  modal.classList.add('is-open')
  modal.setAttribute('aria-hidden', 'false')
  document.body.classList.add('has-modal')
  window.setTimeout(() => {
    modal.querySelector('.icon-btn, .solid-button, button')?.focus?.({ preventScroll: true })
  }, 80)
}

function closeModal(id) {
  const modal = $(`#${id}`)
  if (!modal) return
  modal.classList.remove('is-open')
  modal.setAttribute('aria-hidden', 'true')
  if (!document.querySelector('.modal.is-open')) document.body.classList.remove('has-modal')
  const previous = modal.dataset.previousFocus
  if (previous) {
    document.getElementById(previous)?.focus?.({ preventScroll: true })
  }
}

function bindHelp() {
  $('#helpButton').addEventListener('click', () => openModal('helpModal'))
  $('#panelHelp').addEventListener('click', () => openModal('helpModal'))
  if (bridge.localPreview) $('#resetLocalDemo').hidden = false
  $('#resetLocalDemo').addEventListener('click', () => {
    quota.resetLocal()
    toast('本地演示次数已经重置', 'success')
    closeModal('helpModal')
  })
}

function bindDragAndDrop() {
  const imageInput = $('#imageInput')
  const modelInput = $('#modelInput')
  const overlay = $('#stageDrag')

  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files')

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event) || exporting) return
    event.preventDefault()
    dragDepth += 1
    overlay.hidden = false
  })
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event) || exporting) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    overlay.hidden = false
  })
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) overlay.hidden = true
  })
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event) || exporting) return
    event.preventDefault()
    dragDepth = 0
    overlay.hidden = true
    const files = Array.from(event.dataTransfer?.files || [])
    if (!files.length) return
    if (files.some((file) => !isImageFile(file))) {
      importModel(files)
    } else {
      const file = files.find((item) => isImageFile(item))
      if (file) importImage(file)
    }
  })
}

function bindViewport() {
  window.visualViewport?.addEventListener('resize', () => layoutStage())
  window.addEventListener('orientationchange', () => {
    setTimeout(layoutStage, 160)
  })
}

async function syncContainerState() {
  if (!bridge.hasSdk) return
  const state = await bridge.getContainerState()
  if (state) applyContainerState(state)
  bridge.onContainerChange((next) => applyContainerState(next))
}

function applyContainerState(state) {
  if (!state) return
  if (state.orientation) {
    app.dataset.orientation = state.orientation
  }
  if (state.safeArea) {
    if (Number.isFinite(Number(state.safeArea.top))) {
      app.style.setProperty('--safe-top', `${state.safeArea.top}px`)
    }
    if (Number.isFinite(Number(state.safeArea.bottom))) {
      app.style.setProperty('--safe-bottom', `${state.safeArea.bottom}px`)
    }
  }
  if (state.orientation) {
    window.setTimeout(layoutStage, 120)
  }
}

function layoutStage() {
  if (!stage) return
  const host = $('#stageHost')
  const frame = $('#stageFrame')
  const hostWidth = host.clientWidth
  if (!hostWidth) return
  const topbarHeight = $('.topbar').offsetHeight
  const headingHeight = $('.stage-heading').offsetHeight
  const footerHeight = $('.stage-footer').offsetHeight
  const isMobile = window.innerWidth <= 820
  const viewportHeight = window.visualViewport?.height || window.innerHeight
  const reserved = topbarHeight + headingHeight + footerHeight + (isMobile ? 26 : 54)
  const maxHeight = isMobile
    ? Math.max(260, Math.min(viewportHeight * 0.54, 560))
    : Math.max(300, Math.min(viewportHeight - reserved, 720))
  const aspect = Number(settings.aspect) || 1
  let width = hostWidth
  let height = width / aspect
  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }
  if (width > hostWidth) {
    width = hostWidth
    height = width / aspect
  }
  frame.style.width = `${Math.max(220, Math.round(width))}px`
  frame.style.height = `${Math.max(220, Math.round(height))}px`
  stage.resize()
}

function applySettingsToUI() {
  $('#bounceRange').value = String(settings.bounce)
  $('#squashRange').value = String(settings.squash)
  $('#speedRange').value = String(settings.speed)
  $('#swayRange').value = String(settings.sway)
  $('#jellyRange').value = String(settings.jelly)
  $('#bounceValue').textContent = String(settings.bounce)
  $('#squashValue').textContent = String(settings.squash)
  $('#speedValue').textContent = `${Number(settings.speed).toFixed(1)}×`
  $('#swayValue').textContent = String(settings.sway)
  $('#jellyValue').textContent = String(settings.jelly)
  $('#spinSpeedRange').value = String(settings.spinSpeed)
  $('#spinSpeedValue').textContent = `${settings.spinSpeed} 圈/循环`
  $('#shadowToggle').checked = settings.shadow
  $('#spinToggle').checked = settings.spin
  $('#sizeSelect').value = String(settings.size)
  $('#qualitySelect').value = String(settings.quality)
  $('#fpsSelect').value = String(settings.fps)
  $('#durationSelect').value = String(settings.loopDuration)
  $('#aspectSwitch')
    .querySelectorAll('button')
    .forEach((button) => {
      button.classList.toggle('is-active', Number(button.dataset.aspect) === settings.aspect)
    })
  $$('.range-row input[type="range"]').forEach((input) => paintRange(input))
  $('#speedRange').style.setProperty('--fill', `${rangePercent($('#speedRange'))}%`)
  setMode(settings.mode, { silentStage: true })
  updateBackgroundTabs()
  updateBackgroundNote()
  updateBackgroundChip()
  updateLoopMeta()
  updateOutputMeta()
}

function applySettingsToStage() {
  stage.applyOptions({ ...settings, fps: settings.fps })
  stage.setAspect(settings.aspect)
  stage.setMode(settings.mode)
  stage.setBackgroundMode(settings.background)
  $('#stageFrame').dataset.bg = settings.background
  $('#stageFrame').classList.toggle('has-bg', settings.background === 'image')
}

function updateSourceLabels(name) {
  let label = name
  if (!label) {
    if (settings.mode === 'image' && lastImageFile) label = lastImageFile.name
    else if (settings.mode === 'model' && currentModel) label = currentModel.meta.name
    else label = settings.mode === 'model' ? '3D 示例团子' : '示例团子'
  }
  $('#sourceBadge').textContent = label
  $('#stageChip').textContent = label
}

function updateBackgroundChip() {
  const label =
    settings.background === 'white'
      ? '白色背景'
      : settings.background === 'image'
        ? '背景图'
        : '镂空'
  $('#stageBgChip').textContent = label
}

function updateBackgroundTabs() {
  $$('#bgTabs button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.bg === settings.background)
  })
}

function updateBackgroundNote() {
  const note = $('#bgNote')
  if (settings.background === 'white') {
    note.innerHTML = '<svg class="icon"><use href="#i-info" /></svg>白色背景会直接写进 GIF，适合发动态、评论和聊天。'
  } else if (settings.background === 'image') {
    note.innerHTML =
      '<svg class="icon"><use href="#i-info" /></svg>背景图会铺满画布；用干净、低对比的图片，主体会更突出。'
  } else {
    note.innerHTML =
      '<svg class="icon"><use href="#i-info" /></svg>镂空模式会导出透明 GIF，放进深色或彩色页面都不会露白边。'
  }
}

function updateLoopMeta() {
  const frames = Math.max(1, Math.round(Number(settings.loopDuration) * Number(settings.fps)))
  $('#loopMeta').textContent = `${frames} 帧 · ${Number(settings.loopDuration).toFixed(1)} 秒 · ${settings.fps} fps`
  $('#frameEstimate').textContent = `${frames} 帧`
  updateOutputMeta()
}

function updateOutputMeta() {
  if (!stage) return
  const { width, height } = stage.getOutputSize(settings.size, settings.aspect)
  $('#outputMeta').textContent = `${width} × ${height}`
}

function paintRange(input) {
  const min = Number(input.min) || 0
  const max = Number(input.max) || 100
  const value = Number(input.value)
  input.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`)
}

function rangePercent(input) {
  const min = Number(input.min) || 0
  const max = Number(input.max) || 100
  return ((Number(input.value) - min) / (max - min)) * 100
}

function renderQuota(snapshot) {
  const count = $('#remainingCount')
  const unit = $('#remainingUnit')
  const numberWrap = $('.quota-number')
  const promo = $('#unlimitedPromo')
  const infiniteBadge = $('#infiniteBadge')
  const wasInfinite = numberWrap.classList.contains('is-infinite')

  numberWrap.classList.toggle('is-infinite', snapshot.infinite)
  if (snapshot.infinite) {
    count.textContent = '∞'
    unit.textContent = '无限'
  } else {
    count.textContent = String(snapshot.remaining)
    unit.textContent = '次'
  }

  if (snapshot.infinite) {
    if (!wasInfinite || !promo.classList.contains('is-hiding')) {
      promo.classList.add('is-hiding')
      window.setTimeout(() => {
        if (quota.infinite) promo.hidden = true
      }, 380)
    }
    infiniteBadge.hidden = false
  } else {
    promo.hidden = false
    promo.classList.remove('is-hiding')
    infiniteBadge.hidden = true
  }

  const note = $('#quotaNote')
  if (snapshot.infinite) {
    note.textContent = '无限生成已解锁 · 感谢关注'
  } else if (snapshot.remaining <= 0) {
    note.textContent = '次数用完了，关注 UP 主即可立刻解锁无限次'
  } else if (snapshot.cloudState === 'syncing') {
    note.textContent = '正在从云存档同步次数…'
  } else if (snapshot.cloudState === 'error') {
    note.textContent = '云存档暂时离线，本次次数先保存在本机'
  } else if (snapshot.cloudState === 'local') {
    note.textContent = '本地预览模式，次数不会写入云端'
  } else if (snapshot.cloudState === 'synced') {
    note.textContent = '次数已与云存档同步'
  } else {
    note.textContent = '新用户礼包已放入云存档'
  }

  const cloudChip = $('#cloudButton')
  const cloudLabel = $('#cloudLabel')
  cloudChip.dataset.state = snapshot.cloudState
  const labels = {
    syncing: '同步中',
    synced: '云存档',
    local: '仅本地',
    error: '离线',
  }
  cloudLabel.textContent = labels[snapshot.cloudState] || '云存档'
  cloudChip.title = snapshot.cloudMessage || cloudLabel.textContent

  $('#exportButton').classList.toggle('is-empty', !snapshot.infinite && snapshot.remaining <= 0)
  $('#exportButton').title = !snapshot.infinite && snapshot.remaining <= 0
    ? '次数用完了，关注 UP 主即可无限生成'
    : '导出一张无限循环的 GIF'
}

async function runExport() {
  if (exporting) return
  if (!stage) return
  if (!quota.canGenerate()) {
    $('#quotaCard').scrollIntoView({ behavior: 'smooth', block: 'center' })
    $('#quotaCard').classList.add('is-attention')
    window.setTimeout(() => $('#quotaCard').classList.remove('is-attention'), 1200)
    toast('生成次数用完了，关注 UP 主就能无限揉', 'warn')
    return
  }

  exporting = true
  exportSignal = { aborted: false }
  $('#exportButton').disabled = true
  $('#stageHint').classList.add('is-hidden')
  $('#cancelExport').disabled = false
  $('#cancelExport').textContent = '取消导出'
  $('#progressTitle').textContent = '正在揉捏小动图…'
  $('#progressSub').textContent = '先捏好每一帧，再慢慢装订起来。'
  $('#progressTip').textContent = '别关掉页面，它正在努力变 Q。'
  setProgress(0, '准备中')
  openModal('progressModal')

  try {
    const result = await exportGif({
      stage,
      settings,
      signal: exportSignal,
      onProgress: ({ phase, progress, label, current, frames }) => {
        const percent = Math.min(100, Math.max(0, Math.round(progress * 100)))
        if (phase === 'encode') {
          $('#progressTitle').textContent = '正在装订 GIF…'
          $('#progressTip').textContent = '调色和压缩都在后台线程里，画面不会卡住。'
        } else {
          $('#progressTitle').textContent = '正在揉捏小动图…'
        }
        $('#progressSub').textContent = label || '正在努力变 Q'
        const frameText =
          frames && current
            ? phase === 'encode'
              ? `${frames} 帧 · 编码中`
              : `${current} / ${frames} 帧`
            : '准备中'
        setProgress(percent, frameText)
      },
    })

    const consumed = quota.consume()
    closeModal('progressModal')
    showResult(result)
    if (consumed.infinite) {
      toast('GIF 好啦，无限次数不扣减', 'success')
    } else if (consumed.ok) {
      toast(`GIF 好啦，消耗 1 次，还剩 ${consumed.remaining} 次`, 'success')
    }
  } catch (error) {
    closeModal('progressModal')
    if (error?.name === 'AbortError') {
      toast('已取消导出，没有扣除次数', 'warn')
    } else {
      console.error(error)
      toast(error.message || '导出失败，请稍试一次', 'error')
    }
  } finally {
    exporting = false
    exportSignal = null
    $('#exportButton').disabled = false
    $('#cancelExport').disabled = false
    $('#cancelExport').textContent = '取消导出'
  }
}

function setProgress(percent, frameText) {
  const safe = clamp(percent, 0, 100)
  $('#progressFill').style.width = `${safe}%`
  $('#progressPercent').textContent = `${safe}%`
  $('#progressFrames').textContent = frameText
}

function showResult(result) {
  if (currentResult?.url) URL.revokeObjectURL(currentResult.url)
  const url = URL.createObjectURL(result.blob)
  currentResult = { ...result, url }
  $('#resultImage').src = url
  $('#resultSize').textContent = `${result.width} × ${result.height}`
  $('#resultFrames').textContent = `${result.frameCount} 帧 · ${result.fps} fps`
  $('#resultBytes').textContent = formatBytes(result.bytes)
  $('#resultBg').textContent =
    result.transparent ? '镂空' : settings.background === 'image' ? '背景图' : '白色'
  $('#resultHint').textContent = result.transparent
    ? '这是透明背景 GIF，放到深色页面上也不会露白边。'
    : '下载后发到动态、评论或聊天里，都会自己动。'
  $('#resultPreview').dataset.bg = result.transparent ? 'transparent' : 'solid'
  $('#saveGif').hidden = true
  bridge
    .isSupported('saveImageToAlbum')
    .then((supported) => {
      if (supported && currentResult?.url === url) $('#saveGif').hidden = false
    })
    .catch(() => {})
  openModal('resultModal')
}

function makeThumbnail(canvas, max = 110) {
  const ratio = Math.min(1, max / Math.max(canvas.width, canvas.height))
  const thumb = document.createElement('canvas')
  thumb.width = Math.max(1, Math.round(canvas.width * ratio))
  thumb.height = Math.max(1, Math.round(canvas.height * ratio))
  const ctx = thumb.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height)
  return thumb.toDataURL('image/png')
}

function isImageFile(file) {
  return Boolean(file && (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)))
}

function formatCount(value) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`
  return value.toLocaleString('zh-CN')
}

function toast(message, type = 'info', duration = 3200) {
  const stack = $('#toastStack')
  const el = document.createElement('div')
  el.className = `toast toast--${type}`
  const icons = {
    success: 'i-check',
    error: 'i-info',
    warn: 'i-info',
    info: 'i-sparkle',
  }
  el.innerHTML = `<svg class="icon"><use href="#${icons[type] || 'i-sparkle'}" /></svg><span></span>`
  el.querySelector('span').textContent = message
  stack.appendChild(el)
  while (stack.children.length > 3) stack.firstElementChild.remove()
  window.setTimeout(() => {
    el.classList.add('is-out')
    window.setTimeout(() => el.remove(), 260)
  }, duration)
}

init()
