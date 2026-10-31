/**
 * MC 皮肤 → 玩偶模型（给 Q弹 用的精简版）。
 *
 * 数据来自《森罗物语：玩偶工坊》的 Bedrock 1.12 几何：每个面各自一块贴图，
 * uv 是从外面看该面的左上角，uv_size 可以为负（反向展开），还能叠 uv_rotation。
 *
 * 两个必须记住的坑：
 *   1. Bedrock 和 three 的手性不同，绕 X、Z 的旋转角要取反，绕 Y 的保持原样，
 *      否则胳膊会甩进身体里。
 *   2. 六面顶点顺序靠叉积和期望法线比对决定绕序，别手写。
 */

import * as THREE from 'three'

const faceCorners = {
  north: (a) => [
    [a.x1, a.y1, a.z0],
    [a.x0, a.y1, a.z0],
    [a.x0, a.y0, a.z0],
    [a.x1, a.y0, a.z0],
  ],
  south: (a) => [
    [a.x0, a.y1, a.z1],
    [a.x1, a.y1, a.z1],
    [a.x1, a.y0, a.z1],
    [a.x0, a.y0, a.z1],
  ],
  east: (a) => [
    [a.x1, a.y1, a.z1],
    [a.x1, a.y1, a.z0],
    [a.x1, a.y0, a.z0],
    [a.x1, a.y0, a.z1],
  ],
  west: (a) => [
    [a.x0, a.y1, a.z0],
    [a.x0, a.y1, a.z1],
    [a.x0, a.y0, a.z1],
    [a.x0, a.y0, a.z0],
  ],
  up: (a) => [
    [a.x0, a.y1, a.z0],
    [a.x1, a.y1, a.z0],
    [a.x1, a.y1, a.z1],
    [a.x0, a.y1, a.z1],
  ],
  down: (a) => [
    [a.x0, a.y0, a.z1],
    [a.x1, a.y0, a.z1],
    [a.x1, a.y0, a.z0],
    [a.x0, a.y0, a.z0],
  ],
}

const FACE_ORDER = ['north', 'south', 'east', 'west', 'up', 'down']
const FACE_NORMALS = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
}
const FACE_SHADE = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 }
const CORNER_ORDER = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

const num = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const deg2rad = (value) => (Number(value) || 0) * (Math.PI / 180)

export function parseGeometry(source) {
  const geometry = source?.['minecraft:geometry'] ?? source?.geometry
  const entry = Array.isArray(geometry) ? geometry[0] : geometry
  if (!entry?.bones?.length) {
    throw new Error('这份 JSON 里没有 bones，不像是 Bedrock 模型')
  }
  const description = entry.description || {}
  return {
    identifier: description.identifier || 'geometry.custom',
    textureWidth: num(description.texture_width, 64) || 64,
    textureHeight: num(description.texture_height, 64) || 64,
    bones: entry.bones,
  }
}

function rotateUV(cu, cv, rotation) {
  switch (rotation) {
    case 90:
    case -270:
      return [cv, 1 - cu]
    case 180:
    case -180:
      return [1 - cu, 1 - cv]
    case 270:
    case -90:
      return [1 - cv, cu]
    default:
      return [cu, cv]
  }
}

function buildCubeGeometry(cube, ctx, offset) {
  const size = cube.size || [0, 0, 0]
  const inflate = num(cube.inflate, 0)
  const origin = cube.origin || [0, 0, 0]
  const uv = cube.uv

  const box = {
    x0: num(origin[0]) - inflate,
    y0: num(origin[1]) - inflate,
    z0: num(origin[2]) - inflate,
    x1: num(origin[0]) + num(size[0]) + inflate,
    y1: num(origin[1]) + num(size[1]) + inflate,
    z1: num(origin[2]) + num(size[2]) + inflate,
  }

  if (box.x1 - box.x0 <= 0 || box.y1 - box.y0 <= 0 || box.z1 - box.z0 <= 0) return null

  const positions = []
  const uvs = []
  const normals = []
  const shades = []
  const indices = []

  for (const faceName of FACE_ORDER) {
    const face = uv?.[faceName]
    if (!face) continue

    const rotation = num(face.uv_rotation, 0)
    const [u0, v0] = face.uv || [0, 0]
    const [sw, sh] = face.uv_size || [0, 0]
    const corners = faceCorners[faceName](box)
    const base = positions.length / 3
    const normal = FACE_NORMALS[faceName]
    const shade = FACE_SHADE[faceName]

    for (let i = 0; i < 4; i += 1) {
      const [x, y, z] = corners[i]
      positions.push(x - offset[0], y - offset[1], z - offset[2])

      const [cu, cv] = rotateUV(CORNER_ORDER[i][0], CORNER_ORDER[i][1], rotation)
      uvs.push(
        (num(u0) + cu * num(sw)) / ctx.textureWidth,
        1 - (num(v0) + cv * num(sh)) / ctx.textureHeight,
      )
      normals.push(normal[0], normal[1], normal[2])
      shades.push(shade, shade, shade)
    }

    const p0 = new THREE.Vector3(corners[0][0], corners[0][1], corners[0][2])
    const p1 = new THREE.Vector3(corners[1][0], corners[1][1], corners[1][2])
    const p2 = new THREE.Vector3(corners[2][0], corners[2][1], corners[2][2])
    const computed = p1.sub(p0).cross(p2.sub(p0))
    const flip = computed.dot(new THREE.Vector3(normal[0], normal[1], normal[2])) < 0

    if (flip) indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    else indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  if (!indices.length) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3))
  geometry.setIndex(indices)
  return geometry
}

/** 皮肤比模型声明的贴图小时（64×32），越界方块要隐藏，否则采样出黑块。 */
function isCubeOutsideSkin(cube, ctx) {
  const uv = cube.uv
  if (!uv) return false
  for (const faceName of FACE_ORDER) {
    const face = uv[faceName]
    if (!face) continue
    const [u0, v0] = face.uv || [0, 0]
    const [sw, sh] = face.uv_size || [0, 0]
    if (
      Math.min(u0, u0 + sw) < 0 ||
      Math.max(u0, u0 + sw) > ctx.limitWidth ||
      Math.min(v0, v0 + sh) < 0 ||
      Math.max(v0, v0 + sh) > ctx.limitHeight
    ) {
      return true
    }
  }
  return false
}

/** 64×32 老皮肤只画了右半边，按官方 1.8 规则镜像补出左臂左腿。 */
export function upgradeLegacySkin(canvas, width) {
  const scale = width / 64
  const block = 16 * scale
  const out = document.createElement('canvas')
  out.width = width
  out.height = width
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(canvas, 0, 0)
  const mirror = (srcX, srcY, destX, destY) => {
    ctx.save()
    ctx.translate(destX + block, destY)
    ctx.scale(-1, 1)
    ctx.drawImage(canvas, srcX, srcY, block, block, 0, 0, block, block)
    ctx.restore()
  }
  mirror(0, 16 * scale, 16 * scale, 48 * scale)
  mirror(40 * scale, 16 * scale, 32 * scale, 48 * scale)
  return out
}

export function createSkinTexture(canvas, renderer) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  if (renderer) texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  texture.needsUpdate = true
  return texture
}

export function createDollMaterial(texture, skinSize) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    vertexColors: true,
    alphaTest: 0.5,
    transparent: false,
    side: THREE.FrontSide,
  })
  material.name = 'mc_doll_skin'
  material.userData.skinSize = skinSize
  return material
}

/**
 * 构建玩偶。返回的 root 会把模型缩放到 Q弹 舞台的通用尺寸（最大边 2.35），
 * 底部贴地、水平居中，这样已有的压缩拉伸逻辑能直接套上去。
 */
export function buildDoll({ geometry, material, targetSize = 2.35 }) {
  const parsed = parseGeometry(geometry)
  const root = new THREE.Group()
  root.name = 'MCDoll'

  const ctx = {
    textureWidth: parsed.textureWidth,
    textureHeight: parsed.textureHeight,
    limitWidth: parsed.textureWidth,
    limitHeight: parsed.textureHeight,
  }
  if (material?.userData?.skinSize) {
    const { width, height } = material.userData.skinSize
    const scale = width / parsed.textureWidth
    ctx.limitWidth = width / scale
    ctx.limitHeight = height / scale
  }

  let cubeCount = 0
  let overlayCount = 0
  let hiddenCount = 0

  for (const bone of parsed.bones) {
    const bonePivot = bone.pivot || [0, 0, 0]
    const boneGroup = new THREE.Group()
    boneGroup.name = bone.name || 'bone'
    boneGroup.userData.bone = bone.name
    boneGroup.position.set(num(bonePivot[0]), num(bonePivot[1]), num(bonePivot[2]))
    if (bone.rotation) {
      boneGroup.rotation.set(
        deg2rad(bone.rotation[0]) * -1,
        deg2rad(bone.rotation[1]),
        deg2rad(bone.rotation[2]) * -1,
      )
    }
    root.add(boneGroup)

    for (const cube of bone.cubes || []) {
      if (isCubeOutsideSkin(cube, ctx)) {
        hiddenCount += 1
        continue
      }

      const cubePivot = cube.pivot || bonePivot
      const pivotAbs = [num(cubePivot[0]), num(cubePivot[1]), num(cubePivot[2])]
      const offset = [
        pivotAbs[0] - num(bonePivot[0]),
        pivotAbs[1] - num(bonePivot[1]),
        pivotAbs[2] - num(bonePivot[2]),
      ]

      const cubeGeometry = buildCubeGeometry(cube, ctx, pivotAbs)
      if (!cubeGeometry) continue

      const mesh = new THREE.Mesh(cubeGeometry, material)
      mesh.name = `${bone.name || 'bone'}_${cubeCount}`
      mesh.frustumCulled = false
      mesh.userData.isOverlay = num(cube.inflate, 0) > 0
      mesh.userData.bone = bone.name

      if (cube.rotation) {
        const group = new THREE.Group()
        group.position.set(offset[0], offset[1], offset[2])
        // 手性修正：X、Z 取反，Y 不动
        group.rotation.set(
          deg2rad(cube.rotation[0]) * -1,
          deg2rad(cube.rotation[1]),
          deg2rad(cube.rotation[2]) * -1,
        )
        group.add(mesh)
        boneGroup.add(group)
      } else {
        mesh.position.set(offset[0], offset[1], offset[2])
        boneGroup.add(mesh)
      }

      cubeCount += 1
      if (mesh.userData.isOverlay) overlayCount += 1
    }
  }

  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) throw new Error('模型没有可显示的方块')
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z) || 1

  const wrapper = new THREE.Group()
  wrapper.name = 'MCDollRoot'
  wrapper.add(root)
  // 完整居中（含 Y 轴）：舞台那边靠 modelSquash 把枢轴挪到脚底，
  // 这里再自己贴地就会让相机取景偏下、头顶被裁。
  root.position.set(-center.x, -center.y, -center.z)
  wrapper.scale.setScalar(targetSize / maxDimension)
  wrapper.updateMatrixWorld(true)

  return {
    root: wrapper,
    stats: {
      identifier: parsed.identifier,
      cubes: cubeCount,
      overlays: overlayCount,
      hidden: hiddenCount,
      size,
    },
    setOverlayVisible(visible) {
      wrapper.traverse((child) => {
        if (child.isMesh && child.userData.isOverlay) child.visible = visible
      })
    },
  }
}

export function disposeDoll(object) {
  object?.traverse((child) => {
    if (child.isMesh) child.geometry?.dispose()
  })
}
