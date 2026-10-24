import * as THREE from 'three'
import { unzipSync } from 'fflate'
import { formatBytes } from './utils.js'

const MODEL_PRIORITY = ['glb', 'gltf', 'fbx', 'obj', '3mf', 'dae', 'stl', 'ply', '3ds', 'usdz']
const EXTENSION_LABEL = {
  glb: 'GLB',
  gltf: 'glTF',
  fbx: 'FBX',
  obj: 'OBJ',
  '3mf': '3MF',
  dae: 'DAE',
  stl: 'STL',
  ply: 'PLY',
  '3ds': '3DS',
  usdz: 'USDZ',
}

const extensionOf = (name = '') => {
  const clean = name.split('?')[0].split('#')[0]
  const parts = clean.split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : ''
}

const baseName = (path = '') => path.replace(/\\/g, '/').split('/').pop() || path

const cleanPath = (path = '') => {
  try {
    return decodeURIComponent(path)
      .replace(/\\/g, '/')
      .replace(/^[a-zA-Z]:/, '')
      .replace(/^\/+/, '')
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/')
  } catch {
    return path
  }
}

function flattenFiles(files) {
  const output = []
  for (const file of files) {
    if (!file) continue
    output.push({
      name: file.webkitRelativePath || file.name || 'file',
      size: file.size || 0,
      blob: file,
    })
  }
  return output
}

async function expandArchives(files, onProgress) {
  const expanded = []
  const archives = files.filter((entry) => extensionOf(entry.name) === 'zip')
  const direct = files.filter((entry) => extensionOf(entry.name) !== 'zip')
  expanded.push(...direct)

  for (const archive of archives) {
    onProgress?.('正在解包 ZIP…', 0.08)
    const buffer = new Uint8Array(await archive.blob.arrayBuffer())
    const entries = unzipSync(buffer)
    for (const [name, bytes] of Object.entries(entries)) {
      if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').pop().startsWith('.')) {
        continue
      }
      expanded.push({
        name,
        size: bytes.byteLength,
        blob: new Blob([bytes], { type: mimeForName(name) }),
      })
    }
  }
  return expanded
}

function mimeForName(name) {
  const ext = extensionOf(name)
  if (['png'].includes(ext)) return 'image/png'
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'tga') return 'image/x-tga'
  if (ext === 'ktx2') return 'image/ktx2'
  if (ext === 'ktx') return 'image/ktx'
  if (ext === 'dds') return 'image/vnd-ms.dds'
  if (ext === 'hdr') return 'image/vnd.radiance'
  if (ext === 'exr') return 'image/x-exr'
  if (ext === 'basis') return 'image/basis'
  if (ext === 'bin') return 'application/octet-stream'
  if (ext === 'gltf') return 'model/gltf+json'
  if (ext === 'glb') return 'model/gltf-binary'
  if (ext === 'mtl') return 'text/plain'
  return 'application/octet-stream'
}

function chooseMainFile(files) {
  const candidates = files
    .map((entry) => ({ ...entry, ext: extensionOf(entry.name) }))
    .filter((entry) => MODEL_PRIORITY.includes(entry.ext))
  candidates.sort((a, b) => {
    const ai = MODEL_PRIORITY.indexOf(a.ext)
    const bi = MODEL_PRIORITY.indexOf(b.ext)
    if (ai !== bi) return ai - bi
    return a.name.length - b.name.length
  })
  return candidates[0] || null
}

function createBlobMap(files) {
  const map = new Map()
  const urls = []
  for (const entry of files) {
    const url = URL.createObjectURL(entry.blob)
    urls.push(url)
    const clean = cleanPath(entry.name)
    const base = baseName(clean)
    map.set(clean, url)
    map.set(base, url)
    map.set(encodeURIComponent(clean), url)
    map.set(encodeURIComponent(base), url)
    const lower = clean.toLowerCase()
    map.set(lower, url)
    map.set(base.toLowerCase(), url)
  }
  return { map, urls }
}

function makeManager(map, onProgress) {
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    if (!url || /^(blob:|data:|https?:)/i.test(url)) return url
    const clean = cleanPath(url.split('?')[0].split('#')[0])
    const base = baseName(clean)
    return (
      map.get(clean) ||
      map.get(base) ||
      map.get(clean.toLowerCase()) ||
      map.get(base.toLowerCase()) ||
      map.get(encodeURIComponent(clean)) ||
      map.get(encodeURIComponent(base)) ||
      url
    )
  })
  manager.onStart = () => onProgress?.('正在读取模型资源…')
  manager.onError = (url) => {
    // Missing optional textures should not block the model itself.
    console.warn('[Q弹] 资源载入失败：', url)
  }
  return manager
}

function createDefaultMaterial(color = 0xf5b7c5) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.04,
    envMapIntensity: 0.9,
  })
}

function pickMaterialColor(name) {
  const colors = [0xf4b4c3, 0xc8b8ef, 0xa9d9c1, 0xffd18b, 0xa8c9ef, 0xffc2a8]
  let sum = 0
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i)
  return colors[sum % colors.length]
}

function prepareMaterials(object, { forceMaterial = false, name = '' } = {}) {
  object.traverse((child) => {
    if (!child.isMesh) return
    child.frustumCulled = false
    if (!child.material || forceMaterial) {
      child.material = createDefaultMaterial(pickMaterialColor(name))
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!material) continue
      if ('envMapIntensity' in material) material.envMapIntensity = 0.9
      if ('roughness' in material && material.roughness < 0.16) material.roughness = 0.16
      material.side = material.side ?? THREE.FrontSide
      material.needsUpdate = true
    }
  })
}

function countTriangles(object) {
  let triangles = 0
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return
    const geometry = child.geometry
    if (geometry.index) triangles += geometry.index.count / 3
    else if (geometry.attributes.position) triangles += geometry.attributes.position.count / 3
    if (child.isInstancedMesh) triangles *= child.count
  })
  return Math.round(triangles)
}

/**
 * Normalises an arbitrary scene to fit our 2-unit stage and recentres it.
 * Returns the wrapper plus the visual bottom so the contact shadow can sit
 * exactly on the floor.
 */
function normalizeObject(object) {
  object.updateMatrixWorld(true)
  const originalBox = new THREE.Box3().setFromObject(object)
  if (originalBox.isEmpty()) throw new Error('模型里没有可显示的网格')
  const center = originalBox.getCenter(new THREE.Vector3())
  const size = originalBox.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error('模型尺寸异常，无法载入')
  }

  // Recenter first, then scale the wrapper. This preserves internal transforms
  // of rigged or multi-part files better than mutating every child.
  object.position.sub(center)
  const wrapper = new THREE.Group()
  wrapper.add(object)
  const scale = 2.35 / maxDimension
  wrapper.scale.setScalar(scale)
  wrapper.updateMatrixWorld(true)

  const fittedBox = new THREE.Box3().setFromObject(wrapper)
  return {
    wrapper,
    box: fittedBox,
    size: fittedBox.getSize(new THREE.Vector3()),
    scale,
  }
}

async function loadGltf(file, manager, onProgress) {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ])
  const loader = new GLTFLoader(manager)
  const draco = new DRACOLoader()
  draco.setDecoderPath(new URL('./draco/', document.baseURI).href)
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  onProgress?.('正在解析 glTF / GLB…')

  try {
    // Parse directly with an empty resource path. Blob URLs cannot resolve
    // sibling .bin/texture URIs, but the LoadingManager can map bare relative
    // paths (and ZIP members) to their in-memory blobs.
    const ext = extensionOf(file.name)
    const data = ext === 'glb' ? await file.blob.arrayBuffer() : await file.blob.text()
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(data, '', resolve, reject)
    })
    draco.dispose()
    // 动画片段必须跟着场景一起返回，否则模型只会停在绑定姿势。
    return { scene: gltf.scene, animations: gltf.animations || [] }
  } catch (error) {
    draco.dispose()
    throw error
  }
}

async function loadFbx(file, manager, onProgress) {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
  const loader = new FBXLoader(manager)
  onProgress?.('正在解析 FBX…')
  const buffer = await file.blob.arrayBuffer()
  // 用 parse(buffer, '') 而不是 loadAsync(blobUrl)：loadAsync 会把 path 解析成
  // blob: 前缀的 URL，导致 FBX 里的相对贴图路径也被拼成 blob:，被 URLModifier
  // 的 blob: 短路直接放行，最终贴图加载失败。显式传空 path，贴图保持相对路径，
  // 才能命中我们按文件名兜底的 blob 映射。
  const object = loader.parse(buffer, '')
  return { scene: object, animations: object.animations || [] }
}

async function loadObj(files, main, mainUrl, manager, onProgress) {
  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js')
  const loader = new OBJLoader(manager)
  const mainStem = baseName(main.name).replace(/\.[^.]+$/, '').toLowerCase()
  const mtl = files.find(
    (entry) =>
      extensionOf(entry.name) === 'mtl' &&
      baseName(entry.name).replace(/\.[^.]+$/, '').toLowerCase() === mainStem,
  )
  const anyMtl = mtl || files.find((entry) => extensionOf(entry.name) === 'mtl')
  if (anyMtl) {
    try {
      const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js')
      const mtlLoader = new MTLLoader(manager)
      const text = await anyMtl.blob.text()
      const materials = mtlLoader.parse(text, '')
      if (materials) {
        materials.preload()
        loader.setMaterials(materials)
      }
    } catch (error) {
      console.warn('[Q弹] MTL 材质读取失败，将使用默认材质', error)
    }
  }
  onProgress?.('正在解析 OBJ…')
  return loader.loadAsync(mainUrl)
}

async function loadStl(url, onProgress) {
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js')
  onProgress?.('正在解析 STL…')
  const geometry = await new STLLoader().loadAsync(url)
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry, createDefaultMaterial())
}

async function loadPly(url, onProgress) {
  const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js')
  onProgress?.('正在解析 PLY…')
  const geometry = await new PLYLoader().loadAsync(url)
  geometry.computeVertexNormals()
  const hasColors = Boolean(geometry.attributes.color)
  const material = new THREE.MeshStandardMaterial({
    color: hasColors ? 0xffffff : 0xf3c5bd,
    vertexColors: hasColors,
    roughness: 0.42,
    metalness: 0.04,
  })
  return new THREE.Mesh(geometry, material)
}

async function load3mf(url, onProgress) {
  const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js')
  onProgress?.('正在解析 3MF…')
  return new ThreeMFLoader().loadAsync(url)
}

async function loadDae(url, manager, onProgress) {
  const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js')
  onProgress?.('正在解析 DAE…')
  const result = await new ColladaLoader(manager).loadAsync(url)
  return result.scene
}

async function load3ds(url, manager, onProgress) {
  const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js')
  onProgress?.('正在解析 3DS…')
  return new TDSLoader(manager).loadAsync(url)
}

async function loadUsdz(url, manager, onProgress) {
  const { USDZLoader } = await import('three/addons/loaders/USDZLoader.js')
  onProgress?.('正在解析 USDZ…')
  return new USDZLoader(manager).loadAsync(url)
}

export async function loadModelFiles(inputFiles, { onProgress } = {}) {
  const directFiles = flattenFiles(Array.from(inputFiles || []))
  if (!directFiles.length) throw new Error('没有选择模型文件')

  onProgress?.('正在准备模型文件…', 0.03)
  const files = await expandArchives(directFiles, onProgress)
  const main = chooseMainFile(files)
  if (!main) {
    throw new Error('没有找到支持的模型。请选择 GLB / GLTF / FBX / OBJ / STL / PLY / 3MF / DAE / 3DS / USDZ 或 ZIP')
  }

  const { map, urls } = createBlobMap(files)
  const manager = makeManager(map, onProgress)
  const mainUrl = URL.createObjectURL(main.blob)
  urls.push(mainUrl)
  const ext = extensionOf(main.name)
  onProgress?.(`正在载入 ${EXTENSION_LABEL[ext] || ext.toUpperCase()}…`, 0.12)

  let loaded
  switch (ext) {
    case 'glb':
    case 'gltf':
      loaded = await loadGltf(main, manager, onProgress)
      break
    case 'fbx':
      loaded = await loadFbx(main, manager, onProgress)
      break
    case 'obj':
      loaded = { scene: await loadObj(files, main, mainUrl, manager, onProgress), animations: [] }
      break
    case 'stl':
      loaded = { scene: await loadStl(mainUrl, onProgress), animations: [] }
      break
    case 'ply':
      loaded = { scene: await loadPly(mainUrl, onProgress), animations: [] }
      break
    case '3mf':
      loaded = { scene: await load3mf(mainUrl, onProgress), animations: [] }
      break
    case 'dae':
      loaded = { scene: await loadDae(mainUrl, manager, onProgress), animations: [] }
      break
    case '3ds':
      loaded = { scene: await load3ds(mainUrl, manager, onProgress), animations: [] }
      break
    case 'usdz':
      loaded = { scene: await loadUsdz(mainUrl, manager, onProgress), animations: [] }
      break
    default:
      throw new Error('暂不支持这个模型格式')
  }

  const object = loaded?.scene
  const animations = loaded?.animations || []
  if (!object) throw new Error('模型解析结果为空')
  prepareMaterials(object, {
    forceMaterial: ext === 'stl',
    name: main.name,
  })

  // Remove pinned lights/cameras included in some FBX / DAE exports; our
  // lighting rig should be the only one affecting the plush.
  const remove = []
  object.traverse((child) => {
    if (child.isLight || child.isCamera) remove.push(child)
  })
  remove.forEach((child) => child.parent?.remove(child))

  const normalized = normalizeObject(object)
  const triangles = countTriangles(object)

  // Keep the blob URLs alive until the model is replaced; textures can be
  // decoded lazily by the GPU after loadAsync resolves.
  return {
    root: normalized.wrapper,
    // 动画混合器要挂在原始场景上，轨道里的节点名才能被正确解析。
    animationRoot: object,
    animations,
    box: normalized.box,
    size: normalized.size,
    meta: {
      name: main.name,
      format: EXTENSION_LABEL[ext] || ext.toUpperCase(),
      files: files.length,
      size: files.reduce((sum, entry) => sum + entry.size, 0),
      triangles,
      partCount: countMeshes(object),
      animationCount: animations.length,
      animationNames: animations.map((clip) => clip.name || '动画'),
      sizeLabel: formatBytes(files.reduce((sum, entry) => sum + entry.size, 0)),
    },
    revoke() {
      urls.forEach((url) => {
        try {
          URL.revokeObjectURL(url)
        } catch {
          /* noop */
        }
      })
    },
  }
}

function countMeshes(object) {
  let count = 0
  object.traverse((child) => {
    if (child.isMesh) count += 1
  })
  return count
}

export function disposeObject(object) {
  if (!object) return
  object.traverse((child) => {
    if (!child.isMesh) return
    child.geometry?.dispose?.()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!material) continue
      for (const value of Object.values(material)) {
        if (value && value.isTexture) value.dispose()
      }
      material.dispose?.()
    }
  })
}
