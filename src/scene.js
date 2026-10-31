import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { disposeObject } from './model-loader.js'

const VERTEX_SHADER = /* glsl */ `
  uniform float uPhase;
  uniform float uAmp;
  uniform float uStretch;
  uniform float uSway;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 p = position;

    // Bottom stays planted while the top telescopes up and down. The
    // horizontal squeeze is only there to preserve the plush's volume.
    float anchor = uv.y;
    p.y += uStretch * anchor;
    p.x *= 1.0 - uStretch * 0.2;

    float ex = (uv.x - 0.5) * 2.0;
    float ey = (uv.y - 0.5) * 2.0;
    float edge = smoothstep(0.28, 1.0, max(abs(ex), abs(ey)));

    p.x += sin(uv.y * 8.0 + uPhase * 2.0) * uAmp * 0.018 * edge;
    p.y += sin(uv.x * 7.0 - uPhase * 1.4) * uAmp * 0.012 * edge;
    p.z += (1.0 - ex * ex) * (1.0 - ey * ey) * uAmp * 0.035;
    p.x += sin(uv.y * 6.2831853 + uPhase) * uSway * 0.014 * edge;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  varying vec2 vUv;

  void main() {
    vec4 color = texture2D(uTex, vUv);
    if (color.a < 0.015) discard;

    float sheen = (1.0 - smoothstep(0.0, 0.84, distance(vUv, vec2(0.32, 0.2)))) * 0.11;
    float bottom = smoothstep(0.35, 1.0, vUv.y) * 0.045;
    color.rgb = clamp(color.rgb * (1.0 + sheen - bottom), 0.0, 1.0);

    // 亮度 / 对比度 / 饱和度（用户调色，实时 + 导出同步）。
    color.rgb += uBrightness;
    color.rgb = (color.rgb - 0.5) * uContrast + 0.5;
    float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(luma), color.rgb, uSaturation);

    gl_FragColor = color;
  }
`

function makeGlowTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(30, 20, 18, 0.52)')
  gradient.addColorStop(0.38, 'rgba(30, 20, 18, 0.3)')
  gradient.addColorStop(0.72, 'rgba(30, 20, 18, 0.09)')
  gradient.addColorStop(1, 'rgba(30, 20, 18, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createDemoModel() {
  const group = new THREE.Group()

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffead8,
    roughness: 0.56,
    metalness: 0,
    clearcoat: 0.48,
    clearcoatRoughness: 0.35,
    sheen: 0.8,
    sheenColor: new THREE.Color(0xffc6b2),
    envMapIntensity: 0.9,
  })
  const earMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x9a6a52,
    roughness: 0.6,
    metalness: 0,
    clearcoat: 0.32,
    clearcoatRoughness: 0.4,
  })
  const innerEarMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf0a19c,
    roughness: 0.62,
    metalness: 0,
    clearcoat: 0.22,
  })
  const eyeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x322426,
    roughness: 0.18,
    metalness: 0.02,
    clearcoat: 1,
  })
  const shineMaterial = new THREE.MeshBasicMaterial({ color: 0xfffdf5 })
  const blushMaterial = new THREE.MeshBasicMaterial({
    color: 0xff93a8,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.92, 64, 48), bodyMaterial)
  body.scale.set(1, 0.95, 0.9)
  body.position.y = 0.04
  group.add(body)

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 24), earMaterial)
    ear.scale.set(0.92, 1.18, 0.56)
    ear.position.set(side * 0.56, 0.82, 0.04)
    ear.rotation.z = side * 0.34
    group.add(ear)

    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.21, 24, 18), innerEarMaterial)
    inner.scale.set(0.72, 1.1, 0.25)
    inner.position.set(side * 0.57, 0.83, 0.22)
    inner.rotation.z = side * 0.34
    group.add(inner)

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), eyeMaterial)
    eye.position.set(side * 0.31, 0.2, 0.775)
    group.add(eye)

    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), shineMaterial)
    shine.position.set(side * 0.285, 0.245, 0.86)
    group.add(shine)

    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), blushMaterial)
    blush.scale.set(1.45, 0.8, 1)
    blush.position.set(side * 0.56, -0.03, 0.72)
    blush.rotation.y = side * -0.2
    group.add(blush)
  }

  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.075, 0.018, 8, 24, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x5b3531 }),
  )
  mouth.position.set(0, -0.02, 0.87)
  mouth.rotation.z = Math.PI
  group.add(mouth)

  const bowMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xff955c,
    roughness: 0.42,
    clearcoat: 0.4,
  })
  for (const side of [-1, 1]) {
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.4, 4), bowMaterial)
    bow.position.set(side * 0.23, -0.72, 0.63)
    bow.rotation.z = side * (Math.PI / 2)
    bow.rotation.y = side * 0.25
    group.add(bow)
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14), bowMaterial)
  knot.position.set(0, -0.72, 0.66)
  group.add(knot)

  group.traverse((child) => {
    if (child.isMesh) child.frustumCulled = false
  })
  return group
}

function drawCover(ctx, image, width, height) {
  const iw = image.width
  const ih = image.height
  if (!iw || !ih) {
    ctx.fillStyle = '#f4ede2'
    ctx.fillRect(0, 0, width, height)
    return
  }
  const scale = Math.max(width / iw, height / ih)
  const dw = iw * scale
  const dh = ih * scale
  ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh)
}

export class QStage {
  constructor({ canvas, frame, onStatus }) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: true })
    this.frame = frame
    this.onStatus = onStatus || (() => {})

    this.mode = 'image'
    this.background = 'transparent'
    this.backgroundCanvas = null
    this.bgCache = null
    this.bgCacheSize = ''
    this.aspect = 1
    this.imageAspect = 1
    this.imageReady = false
    this.imageTexture = null
    this.imageSourceCanvas = null
    this.modelResult = null
    this.demoModel = null
    this.dollModel = null
    this.modelSize = new THREE.Vector3(2.3, 2.3, 2.3)
    this.modelHeight = 2.35
    this.userYaw = 0
    this.dragging = false
    this.elapsed = 0
    this.impulse = 0
    this.lastTime = performance.now()
    this.previewW = 0
    this.previewH = 0
    this.exportW = 0
    this.exportH = 0
    this.exporting = false
    this.previewPaused = false
    this.running = false
    this.destroyed = false
    this.resizeObserver = null
    this.raf = 0

    // 3D 模型动画
    this.modelMixer = null
    this.modelClip = null
    this.modelAnimations = null
    this.modelAction = null
    this.animPlaying = true

    // GIF 动图贴图
    this.gifFrames = null
    this.gifStarts = null
    this.gifDuration = 0
    this.gifCanvas = null
    this.gifFrameIndex = -1
    this.gifPlaying = true

    this.options = {
      bounce: 62,
      squash: 68,
      speed: 1,
      sway: 35,
      jelly: 46,
      shadow: true,
      spin: false,
      loopDuration: 2,
      exposure: 1.05,
      lightIntensity: 1,
      envIntensity: 0.9,
      imgBrightness: 0,
      imgContrast: 1,
      imgSaturation: 1,
    }
    this.cycles = 2
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(1)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.buildImageScene()
    this.buildModelScene()
    this.bindResize()
    this.applyOptions(this.options)
  }

  buildImageScene() {
    this.imageScene = new THREE.Scene()
    this.imageCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 20)
    this.imageCamera.position.set(0, 0, 3)
    this.imageGroup = new THREE.Group()
    this.imageScene.add(this.imageGroup)

    this.imageMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: null },
        uPhase: { value: 0 },
        uAmp: { value: 0.46 },
        uStretch: { value: 0 },
        uSway: { value: 0.35 },
        uBrightness: { value: 0 },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.imageMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 72, 72), this.imageMaterial)
    this.imageMesh.frustumCulled = false
    this.imageGroup.add(this.imageMesh)
  }

  buildModelScene() {
    this.modelScene = new THREE.Scene()
    this.modelCamera = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
    this.modelScene.add(this.modelCamera)

    this.hemi = new THREE.HemisphereLight(0xfff6e8, 0x8d7ea8, 1.5)
    this.modelScene.add(this.hemi)

    this.keyLight = new THREE.DirectionalLight(0xfff3df, 3.1)
    this.keyLight.position.set(4, 6, 5)
    this.modelScene.add(this.keyLight)

    this.fillLight = new THREE.DirectionalLight(0xffc7d7, 1.25)
    this.fillLight.position.set(-5, 1.5, 3)
    this.modelScene.add(this.fillLight)

    this.rimLight = new THREE.DirectionalLight(0xb8d5ff, 1.7)
    this.rimLight.position.set(0, 3, -5)
    this.modelScene.add(this.rimLight)

    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
      this.modelScene.environment = this.envRT.texture
      pmrem.dispose()
    } catch (error) {
      console.warn('[Q弹] 环境光初始化失败', error)
    }

    this.modelRig = new THREE.Group()
    this.modelSquash = new THREE.Group()
    this.modelContent = new THREE.Group()
    this.modelRig.add(this.modelSquash)
    this.modelSquash.add(this.modelContent)
    this.modelScene.add(this.modelRig)

    this.contactShadowMaterial = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      toneMapped: false,
    })
    this.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.contactShadowMaterial)
    this.contactShadow.rotation.x = -Math.PI / 2
    this.contactShadow.renderOrder = 2
    this.modelScene.add(this.contactShadow)

    this.demoModel = createDemoModel()
    this.applyDemoBounds()
  }

  applyDemoBounds() {
    const box = new THREE.Box3().setFromObject(this.demoModel)
    const center = box.getCenter(new THREE.Vector3())
    this.demoModel.position.x -= center.x
    this.demoModel.position.y -= center.y
    this.demoModel.position.z -= center.z
    this.modelContent.clear()
    this.modelContent.add(this.demoModel)
    box.setFromObject(this.demoModel)
    this.modelSize = box.getSize(new THREE.Vector3())
    this.configureModelPivot(box)
    this.fitModelCamera()
  }

  configureModelPivot(box) {
    const size = box.getSize(new THREE.Vector3())
    this.modelHeight = Math.max(0.4, size.y)
    // The pivot sits on the floor. Scaling this group's Y makes the top
    // stretch while the bottom stays planted, which is the requested
    // "上下伸缩" motion instead of a whole-body bounce.
    this.modelSquash.position.y = box.min.y
    this.modelContent.position.y = -box.min.y
    this.placeShadow(box)
  }

  placeShadow(box) {
    const size = box.getSize(new THREE.Vector3())
    const maxFoot = Math.max(size.x, size.z, 0.5)
    this.shadowBaseScale = maxFoot * 1.4
    this.contactShadow.position.y = box.min.y - 0.03
    this.contactShadow.scale.set(this.shadowBaseScale, this.shadowBaseScale, 1)
  }

  setModel(result) {
    if (!result?.root) return
    this.clearModel()
    this.modelContent.clear()
    this.modelResult = result
    this.modelContent.add(result.root)
    const box = new THREE.Box3().setFromObject(result.root)
    this.modelSize = box.getSize(new THREE.Vector3())
    this.configureModelPivot(box)
    this.fitModelCamera()

    // 有动作就默认播放第一段；用户可在侧栏下拉框切换。时间轴由 applyTime 统一驱动，导出同样生效。
    this.modelAnimations = result.animations?.length ? result.animations : null
    this.playModelAnimation(0)
    // 新载入的模型材质 envMapIntensity 被 prepareMaterials 重置，这里按当前调色设置重刷。
    this.applyLighting()
  }

  /**
   * 挂上一个 MC 皮肤玩偶。它和 3D 模型走同一套舞台：
   * 同一个 modelContent / 压缩枢轴 / 接触阴影，所以上下伸缩、摇摆、旋转全都复用。
   */
  setDoll(doll) {
    this.clearModel()
    // 清掉可能还挂着的示例团子，免得和玩偶叠在一起
    this.modelContent.clear()
    if (!doll) {
      this.fitModelCamera()
      return
    }
    this.dollModel = doll.root
    this.modelContent.add(doll.root)
    const box = new THREE.Box3().setFromObject(doll.root)
    this.modelSize = box.getSize(new THREE.Vector3())
    this.configureModelPivot(box)
    this.fitModelCamera()
  }

  hasDoll() {
    return Boolean(this.dollModel)
  }

  /**
   * 切换到指定索引的动作（无动作或索引越界则忽略）。
   * 只重建一个 mixer 并播放目标 clip，实际时间仍由 updateModelAnimation 的 setTime 驱动。
   */
  playModelAnimation(index) {
    if (!this.modelAnimations?.length || !this.modelResult) return
    const clip = this.modelAnimations[index]
    if (!clip) return
    if (!this.modelMixer) {
      const root = this.modelResult.animationRoot || this.modelResult.root
      this.modelMixer = new THREE.AnimationMixer(root)
    }
    this.modelMixer.stopAllAction()
    this.modelClip = clip
    this.modelAction = this.modelMixer.clipAction(clip)
    this.modelAction.setLoop(THREE.LoopRepeat, Infinity)
    this.modelAction.play()
  }

  setModelAnimPlaying(playing) {
    this.animPlaying = playing !== false
  }

  setGifPlaying(playing) {
    this.gifPlaying = playing !== false
  }

  clearModel() {
    if (this.dollModel) {
      this.modelContent.remove(this.dollModel)
      this.dollModel.traverse((child) => {
        if (child.isMesh) child.geometry?.dispose()
      })
      this.dollModel = null
    }
    if (this.modelMixer) {
      this.modelMixer.stopAllAction()
      this.modelMixer = null
    }
    this.modelClip = null
    this.modelAnimations = null
    this.modelAction = null
    if (this.modelResult) {
      this.modelContent.remove(this.modelResult.root)
      disposeObject(this.modelResult.root)
      this.modelResult.revoke?.()
      this.modelResult = null
    }
  }

  restoreDemoModel() {
    this.clearModel()
    if (!this.demoModel) this.demoModel = createDemoModel()
    this.modelContent.clear()
    this.applyDemoBounds()
  }

  hasRealModel() {
    return Boolean(this.modelResult)
  }

  hasImage() {
    return Boolean(this.imageSourceCanvas)
  }

  installImageTexture(canvas) {
    if (!canvas) return
    this.imageSourceCanvas = canvas
    this.imageAspect = canvas.width / canvas.height
    if (this.imageTexture) this.imageTexture.dispose()
    const texture = new THREE.CanvasTexture(canvas)
    // 图片作为贴图需要「直通」：标记 NoColorSpace，让 GPU 按原始 sRGB 字节采样、
    // 着色器原样输出，与源图亮度一致。若标成 SRGBColorSpace，three.js 会在采样时
    // 做 sRGB→线性解码，而自定义 ShaderMaterial 不会自动回编码，结果中灰被压暗。
    texture.colorSpace = THREE.NoColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.imageTexture = texture
    this.imageMaterial.uniforms.uTex.value = texture
    this.imageReady = true
    this.fitImagePlane()
  }

  setImage(canvas) {
    if (!canvas) return
    this.clearImageAnimation()
    this.installImageTexture(canvas)
  }

  /**
   * 动图输入：frames 是逐帧画布，starts 是每帧在总时长里的起始秒数，
   * canvas 是贴图源画布（会被逐帧重绘）。
   */
  setImageAnimation(frames, starts, duration, canvas) {
    if (!frames?.length || !canvas) return
    this.clearImageAnimation()
    this.installImageTexture(canvas)
    this.gifFrames = frames
    this.gifStarts = starts
    this.gifDuration = Math.max(0.001, Number(duration) || 0.001)
    this.gifCanvas = canvas
    this.gifFrameIndex = -1
    this.updateImageAnimation(0, this.gifDuration)
  }

  clearImageAnimation() {
    if (this.gifFrames) {
      for (const frame of this.gifFrames) frame?.close?.()
    }
    this.gifFrames = null
    this.gifStarts = null
    this.gifDuration = 0
    this.gifCanvas = null
    this.gifFrameIndex = -1
  }

  updateImageAnimation(t, duration) {
    if (!this.gifFrames || !this.gifCanvas || !this.gifStarts?.length) return
    const span = Math.max(0.001, Number(duration) || 0.001)
    // 一次循环正好播完一遍动图，首尾自然衔接；暂停时固定第一帧。
    const loop = this.gifPlaying ? (((t / span) % 1) + 1) % 1 : 0
    const playhead = loop * this.gifDuration
    let index = 0
    for (let i = 0; i < this.gifStarts.length; i += 1) {
      if (playhead >= this.gifStarts[i]) index = i
      else break
    }
    if (index === this.gifFrameIndex) return
    this.gifFrameIndex = index
    const ctx = this.gifCanvas.getContext('2d')
    const width = this.gifCanvas.width
    const height = this.gifCanvas.height
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(this.gifFrames[index], 0, 0, width, height)
    if (this.imageTexture) this.imageTexture.needsUpdate = true
  }

  updateModelAnimation(t, duration) {
    if (!this.modelMixer || !this.modelClip) return
    const span = Math.max(0.001, Number(duration) || 0.001)
    const clipLength = Math.max(0.001, this.modelClip.duration || 0.001)
    // 同样让动作在一个循环内正好走完一遍，导出 GIF 首尾才不会跳；暂停时停在绑定姿势。
    const loop = this.animPlaying ? (((t / span) % 1) + 1) % 1 : 0
    this.modelMixer.setTime(loop * clipLength)
  }

  fitImagePlane() {
    // Leave headroom for the top edge to telescope upwards without clipping.
    const maxWidth = Math.max(0.25, this.aspect * 0.78)
    const maxHeight = 0.64
    let width = maxWidth
    let height = width / this.imageAspect
    if (height > maxHeight) {
      height = maxHeight
      width = height * this.imageAspect
    }
    this.imageMesh.scale.set(width, height, 1)
    this.imageBaseWidth = width
    this.imageBaseHeight = height
  }

  setMode(mode) {
    this.mode = ['model', 'doll'].includes(mode) ? mode : 'image'
    this.bgCache = null
  }

  setBackgroundMode(mode) {
    this.background = ['white', 'transparent', 'image'].includes(mode) ? mode : 'transparent'
    this.bgCache = null
  }

  setBackgroundImage(canvas) {
    this.backgroundCanvas = canvas || null
    this.bgCache = null
    if (canvas) this.background = 'image'
  }

  applyOptions(options) {
    this.options = { ...this.options, ...options }
    this.cycles = Math.max(1, Math.min(14, Math.round(1.8 * Number(this.options.speed || 2))))
    this.imageMaterial.uniforms.uAmp.value = Number(this.options.jelly) / 100
    this.imageMaterial.uniforms.uSway.value = Number(this.options.sway) / 100
    this.imageMaterial.uniforms.uBrightness.value = Number(this.options.imgBrightness) || 0
    this.imageMaterial.uniforms.uContrast.value = Number(this.options.imgContrast) ?? 1
    this.imageMaterial.uniforms.uSaturation.value = Number(this.options.imgSaturation) ?? 1
    this.applyLighting()
    this.bgCache = null
    if (!this.modelSquash) return
    this.fitModelCamera()
  }

  /**
   * 模型渲染调色：曝光、灯光强度、环境反射强度。
   * 三者都会在预览和逐帧导出（同一个 renderer）里一致生效。
   */
  applyLighting() {
    const exposure = Number(this.options.exposure)
    const light = Number(this.options.lightIntensity)
    const env = Number(this.options.envIntensity)
    if (Number.isFinite(exposure)) {
      this.renderer.toneMappingExposure = exposure
    }
    // 默认主光 3.1 / 补光 1.25 / 轮廓光 1.7 / 半球光 1.5，乘上用户系数统一缩放。
    if (Number.isFinite(light)) {
      this.keyLight.intensity = 3.1 * light
      this.fillLight.intensity = 1.25 * light
      this.rimLight.intensity = 1.7 * light
      this.hemi.intensity = 1.5 * light
    }
    // 环境反射（PMREM RoomEnvironment）作用在 MeshStandard/Physical 材质上。
    if (Number.isFinite(env)) {
      this.modelContent.traverse((child) => {
        if (!child.isMesh) return
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const material of materials) {
          if (material && 'envMapIntensity' in material) material.envMapIntensity = env
        }
      })
      // 示例团子也一并更新。
      if (this.demoModel) {
        this.demoModel.traverse((child) => {
          if (!child.isMesh) return
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const material of materials) {
            if (material && 'envMapIntensity' in material) material.envMapIntensity = env
          }
        })
      }
    }
  }

  setAspect(aspect) {
    if (!Number.isFinite(aspect) || aspect <= 0) return
    this.aspect = aspect
    this.updateCameras()
    this.fitImagePlane()
    this.fitModelCamera()
    this.bgCache = null
    this.resize()
  }

  updateCameras(width = this.aspect, height = 1) {
    const aspect = width / height
    this.imageCamera.left = -aspect / 2
    this.imageCamera.right = aspect / 2
    this.imageCamera.top = 0.5
    this.imageCamera.bottom = -0.5
    this.imageCamera.updateProjectionMatrix()
    this.modelCamera.aspect = aspect
    this.modelCamera.updateProjectionMatrix()
  }

  fitModelCamera() {
    if (!this.modelCamera) return
    const box = new THREE.Box3()
    if (this.dollModel) box.setFromObject(this.dollModel)
    else if (this.modelResult) box.setFromObject(this.modelResult.root)
    else if (this.demoModel) box.setFromObject(this.demoModel)
    if (box.isEmpty()) return
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const radius = Math.max(0.8, sphere.radius)
    const stretchMax = this.modelHeight * (Number(this.options.bounce) / 100) * 0.3
    const fitRadius = radius + stretchMax * 0.5
    const vFov = (this.modelCamera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.2, this.aspect))
    const fitFov = Math.min(vFov, hFov)
    // 0.82 是模型沿用多年的紧凑取景；玩偶是压扁拉伸的，倍率高的时候会顶到边缘，
    // 所以单独留出约两成余量，保证拉伸到最大那一帧也不贴边。
    const padding = this.dollModel ? 1.02 : 0.82
    const distance = (fitRadius / Math.sin(fitFov / 2)) * padding
    this.modelCamera.position.set(0, stretchMax * 0.35 + radius * 0.08, distance)
    this.modelCamera.lookAt(0, stretchMax * 0.35, 0)
    this.modelCamera.near = Math.max(0.01, distance - radius * 4)
    this.modelCamera.far = distance + radius * 8
    this.modelCamera.updateProjectionMatrix()
  }

  bindResize() {
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.frame)
    window.addEventListener('resize', () => this.resize(), { passive: true })
  }

  resize() {
    if (this.destroyed || this.exporting) return
    const rect = this.frame.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    // 预览画布按 dpr 放大后每帧都要整块合成，2 倍在高分屏上明显掉帧；
    // 1.5 倍肉眼几乎看不出差别，像素量却少 44%。导出不受影响。
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    this.pixelRatio = dpr
    const width = Math.max(2, Math.round(rect.width * dpr))
    const height = Math.max(2, Math.round(rect.height * dpr))
    if (width === this.previewW && height === this.previewH && !this.rendererSizeChanged) return
    this.previewW = width
    this.previewH = height
    this.canvas.width = width
    this.canvas.height = height
    this.renderer.setSize(width, height, false)
    this.updateCameras(rect.width, rect.height)
    this.bgCache = null
    this.rendererSizeChanged = false
  }

  start() {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    const tick = (now) => {
      if (!this.running) return
      const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000))
      this.lastTime = now
      if (!document.hidden && !this.previewPaused) {
        this.elapsed += dt
        this.impulse *= Math.exp(-dt * 4.6)
        if (this.impulse < 0.002) this.impulse = 0
        this.renderPreview()
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
    document.addEventListener('visibilitychange', () => {
      this.lastTime = performance.now()
    })
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  pulse() {
    this.impulse = Math.min(1.3, this.impulse + 0.95)
  }

  ensureRendererSize(width, height) {
    if (this.rendererSizeW === width && this.rendererSizeH === height) return
    this.rendererSizeW = width
    this.rendererSizeH = height
    this.renderer.setSize(width, height, false)
    this.updateCameras(width, height)
  }

  rotateModel(delta) {
    if (!Number.isFinite(delta)) return
    this.userYaw += delta
    if (!['model', 'doll'].includes(this.mode)) this.mode = 'model'
  }

  /**
   * 拖动环视期间暂停自动旋转。
   * 按下时把当前总角度并进 userYaw，松手时再把时间轴上的自转角扣掉，
   * 这样按压/松手两个瞬间都不会跳一下，松手后自转从当前角度继续。
   */
  setDragging(active) {
    const next = Boolean(active)
    if (next === this.dragging) return
    if (next) {
      this.userYaw = this.modelRig.rotation.y
      this.dragging = true
      return
    }
    this.dragging = false
    this.userYaw -= this.spinAngle(this.elapsed)
  }

  /** 自转角度只由时间决定，导出才能首尾相接。 */
  spinAngle(t) {
    if (!this.options.spin) return 0
    const duration = Math.max(0.2, Number(this.options.loopDuration) || 2)
    const turns = Math.max(1, Math.min(6, Math.round(Number(this.options.spinSpeed) || 1)))
    return (t / duration) * Math.PI * 2 * turns
  }

  applyTime(t, impulse = 0) {
    const duration = Math.max(0.2, Number(this.options.loopDuration) || 2)
    // 动图换帧与模型动作都挂在这条统一时间轴上：预览和逐帧导出走的是同一段逻辑。
    this.updateImageAnimation(t, duration)
    this.updateModelAnimation(t, duration)
    const phase = (Math.PI * 2 * this.cycles * t) / duration
    const wave = Math.sin(phase)
    const pulseWave = impulse > 0 ? Math.sin(t * 24) * impulse : 0
    const amplitude = (Number(this.options.bounce) / 100) * 0.3
    const squash = Number(this.options.squash) / 100
    // Positive phase stretches the top up; negative phase compresses it down.
    // The squash control deepens the compression side, like a plush being
    // pushed into the table before springing back.
    const compression = 0.45 + squash * 0.6
    let stretch = wave >= 0 ? wave * amplitude : wave * amplitude * compression
    stretch += pulseWave * 0.075
    // Even at 300 the top should never fold through the bottom edge.
    stretch = Math.max(this.mode === 'image' ? -0.47 : -0.55, stretch)
    const sway = Number(this.options.sway) / 100
    const stretchValue = stretch + impulse * 0.06

    if (this.mode === 'image') {
      this.imageGroup.position.y = -0.035
      this.imageGroup.position.x = 0
      this.imageGroup.rotation.z = Math.sin(phase) * sway * 0.035 + pulseWave * 0.02
      // At extreme values, shrink the whole layer just enough that the top
      // never escapes the canvas. Defaults sit below this clamp.
      const projectedTop = (0.5 + Math.max(0, stretchValue)) * this.imageBaseHeight - 0.035
      const fitScale = projectedTop > 0.485 ? 0.485 / projectedTop : 1
      this.imageGroup.scale.set(fitScale, fitScale, 1)
      this.imageMaterial.uniforms.uPhase.value = phase
      this.imageMaterial.uniforms.uAmp.value = Number(this.options.jelly) / 100 + impulse * 0.5
      this.imageMaterial.uniforms.uStretch.value = stretchValue
      this.imageMaterial.uniforms.uSway.value = sway + impulse * 0.4
    } else {
      this.modelRig.position.y = 0
      this.modelSquash.scale.set(1 - stretch * 0.2, 1 + stretch, 1 - stretch * 0.2)
      this.modelRig.rotation.z = Math.sin(phase) * sway * 0.065 + pulseWave * 0.025
      this.modelRig.rotation.x = Math.sin(phase) * sway * 0.012
      const autoYaw = this.dragging
        ? 0
        : this.options.spin
          ? this.spinAngle(t)
          : Math.sin(phase) * sway * 0.2
      this.modelRig.rotation.y = this.userYaw + autoYaw

      if (this.contactShadow) {
        const widthScale = 1 - stretch * 0.22
        const shadowScale = (this.shadowBaseScale || 2) * widthScale
        this.contactShadow.scale.set(shadowScale, shadowScale, 1)
        this.contactShadow.visible = Boolean(this.options.shadow)
        this.contactShadowMaterial.opacity = 0.34 * (1 - Math.max(0, stretch) * 0.55)
      }
    }
  }

  drawBackground(ctx, width, height) {
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    if (this.background === 'white') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
    } else if (this.background === 'image' && this.backgroundCanvas) {
      const key = `${width}x${height}`
      if (!this.bgCache || this.bgCacheSize !== key) {
        const cache = document.createElement('canvas')
        cache.width = width
        cache.height = height
        drawCover(cache.getContext('2d'), this.backgroundCanvas, width, height)
        this.bgCache = cache
        this.bgCacheSize = key
      }
      ctx.drawImage(this.bgCache, 0, 0, width, height)
    } else {
      ctx.clearRect(0, 0, width, height)
    }
    ctx.restore()
  }

  drawSubject(ctx, width, height) {
    const shadow = Boolean(this.options.shadow) && this.mode === 'image'
    ctx.save()
    if (shadow && 'filter' in ctx) {
      const strength = Math.max(0.6, width / 900)
      ctx.filter = `drop-shadow(0 ${Math.round(13 * strength)}px ${Math.round(18 * strength)}px rgba(58, 39, 31, 0.26))`
    }
    ctx.drawImage(this.renderer.domElement, 0, 0, width, height)
    ctx.restore()
  }

  renderPreview() {
    if (!this.previewW || !this.previewH) this.resize()
    const width = this.previewW
    const height = this.previewH
    if (!width || !height) return
    this.ensureRendererSize(width, height)
    const ctx = this.ctx
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.restore()

    this.applyTime(this.elapsed, this.impulse)
    if (this.mode === 'image') {
      this.renderer.render(this.imageScene, this.imageCamera)
    } else {
      this.renderer.render(this.modelScene, this.modelCamera)
    }
    this.drawBackground(ctx, width, height)
    this.drawSubject(ctx, width, height)
  }

  beginExport(width, height) {
    this.exporting = true
    this.previewPaused = true
    this.exportW = width
    this.exportH = height
    this.exportCtx = null
    this.ensureRendererSize(width, height)
    this.bgCache = null
    this.bgCacheSize = ''
  }

  renderExportFrame(ctx, time) {
    const width = this.exportW
    const height = this.exportH
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.restore()

    this.applyTime(time, 0)
    if (this.mode === 'image') {
      this.renderer.render(this.imageScene, this.imageCamera)
    } else {
      this.renderer.render(this.modelScene, this.modelCamera)
    }
    this.drawBackground(ctx, width, height)
    this.drawSubject(ctx, width, height)
  }

  endExport() {
    this.exporting = false
    this.previewPaused = false
    this.lastTime = performance.now()
    this.rendererSizeW = 0
    this.rendererSizeH = 0
    this.bgCache = null
    this.bgCacheSize = ''
    this.resize()
  }

  getOutputSize(longEdge, aspect = this.aspect) {
    const long = Math.max(64, Math.round(longEdge))
    if (aspect >= 1) {
      return { width: long, height: Math.max(2, Math.round(long / aspect)) }
    }
    return { width: Math.max(2, Math.round(long * aspect)), height: long }
  }

  getFrameCount() {
    return Math.max(1, Math.round(Number(this.options.loopDuration) * Number(this.options.fps || 25)))
  }

  destroy() {
    this.destroyed = true
    this.stop()
    this.resizeObserver?.disconnect()
    this.clearImageAnimation()
    this.clearModel()
    this.imageTexture?.dispose()
    this.imageMaterial?.dispose()
    this.imageMesh?.geometry?.dispose()
    this.contactShadowMaterial?.map?.dispose()
    this.contactShadowMaterial?.dispose()
    this.contactShadow?.geometry?.dispose()
    this.renderer.dispose()
  }
}
