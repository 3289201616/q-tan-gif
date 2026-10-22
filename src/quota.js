import { clamp, getStoredJSON, setStoredJSON } from './utils.js'
import { ToyBridge } from './toy-bridge.js'

const KEYS = ToyBridge.cloudKeys
const STORAGE_KEY = 'qtan_quota_v1'
const DEFAULT_REMAINING = 947

/**
 * Quota lives in the official Toy cloud archive, with a local mirror so the
 * UI remains instant and usable when the SDK is unavailable. Cloud access is
 * deliberately restricted to meaningful moments: boot, export, unlock, and
 * page hide. No polling.
 */
export class QuotaStore {
  constructor(bridge) {
    this.bridge = bridge
    this.remaining = DEFAULT_REMAINING
    this.infinite = false
    this.cloudState = 'local'
    this.cloudMessage = ''
    this.dirty = false
    this.writeQueue = Promise.resolve()
    this.listeners = new Set()
    this.initialized = false
    this.loadLocal()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot() {
    return {
      remaining: this.remaining,
      infinite: this.infinite,
      cloudState: this.cloudState,
      cloudMessage: this.cloudMessage,
      initialized: this.initialized,
    }
  }

  emit() {
    const snapshot = this.snapshot()
    this.listeners.forEach((listener) => listener(snapshot))
  }

  setCloudState(state, message = '') {
    this.cloudState = state
    this.cloudMessage = message
    this.emit()
  }

  loadLocal() {
    const saved = getStoredJSON(STORAGE_KEY, null)
    if (!saved || typeof saved !== 'object') return
    const remaining = Number(saved.remaining)
    if (Number.isFinite(remaining)) this.remaining = clamp(Math.round(remaining), 0, DEFAULT_REMAINING)
    this.infinite = Boolean(saved.infinite)
  }

  saveLocal() {
    setStoredJSON(STORAGE_KEY, {
      remaining: this.remaining,
      infinite: this.infinite,
      updatedAt: Date.now(),
    })
  }

  async init() {
    this.initialized = true
    this.emit()

    if (!this.bridge.hasSdk || this.bridge.localPreview) {
      this.setCloudState('local', '本地预览')
      return
    }

    this.setCloudState('syncing', '同步中')
    const result = await this.bridge.readCloud([
      KEYS.remaining,
      KEYS.infinite,
      KEYS.updatedAt,
    ])

    if (!result.ok) {
      if (result.reason === 'unsupported') {
        this.setCloudState('local', '端内不可用')
      } else {
        this.setCloudState('error', result.error?.code === 307044 ? '稍后再同步' : '离线存档')
      }
      return
    }

    const cloudRemaining = result.data[KEYS.remaining]
    const cloudInfinite = result.data[KEYS.infinite]
    const hasCloud = cloudRemaining !== undefined || cloudInfinite !== undefined

    if (!hasCloud) {
      // First visit: seed the new-user allowance into the cloud archive once.
      this.remaining = DEFAULT_REMAINING
      this.infinite = false
      this.dirty = true
      this.saveLocal()
      this.emit()
      const written = await this.persistNow()
      if (written.ok) this.setCloudState('synced', '云存档')
      return
    }

    if (cloudRemaining !== undefined) {
      const parsed = Number(cloudRemaining)
      if (Number.isFinite(parsed)) {
        this.remaining = clamp(Math.round(parsed), 0, DEFAULT_REMAINING)
      }
    }
    if (cloudInfinite !== undefined) {
      this.infinite = String(cloudInfinite) === '1' || cloudInfinite === true
    }
    this.dirty = false
    this.saveLocal()
    this.emit()
    this.setCloudState('synced', '云存档')
  }

  async syncNow() {
    if (!this.bridge.hasSdk || this.bridge.localPreview) {
      this.setCloudState('local', '本地预览')
      return { ok: false, reason: 'local' }
    }
    this.setCloudState('syncing', '同步中')
    const result = await this.bridge.readCloud([KEYS.remaining, KEYS.infinite, KEYS.updatedAt])
    if (!result.ok) {
      this.setCloudState(
        'error',
        result.error?.code === 307044 ? '稍后再同步' : result.reason === 'unsupported' ? '端内不可用' : '同步失败',
      )
      return { ok: false, reason: result.reason, error: result.error }
    }
    const hasCloud = result.data[KEYS.remaining] !== undefined || result.data[KEYS.infinite] !== undefined
    if (!hasCloud) {
      const written = await this.persistNow()
      if (written.ok) this.setCloudState('synced', '云存档')
      return { ok: Boolean(written.ok), reason: written.reason }
    }
    const remaining = Number(result.data[KEYS.remaining])
    if (Number.isFinite(remaining)) {
      this.remaining = clamp(Math.round(remaining), 0, DEFAULT_REMAINING)
    }
    if (result.data[KEYS.infinite] !== undefined) {
      this.infinite = String(result.data[KEYS.infinite]) === '1' || result.data[KEYS.infinite] === true
    }
    this.dirty = false
    this.saveLocal()
    this.emit()
    this.setCloudState('synced', '云存档')
    return { ok: true }
  }

  canGenerate() {
    return this.infinite || this.remaining > 0
  }

  consume() {
    if (this.infinite) {
      this.emit()
      return { ok: true, infinite: true, remaining: this.remaining }
    }
    if (this.remaining <= 0) {
      return { ok: false, infinite: false, remaining: 0 }
    }
    this.remaining -= 1
    this.dirty = true
    this.saveLocal()
    this.emit()
    // Successful export is a key event, so this is one of the few writes.
    this.persist()
    return { ok: true, infinite: false, remaining: this.remaining }
  }

  unlockInfinite() {
    const wasInfinite = this.infinite
    this.infinite = true
    this.dirty = true
    this.saveLocal()
    this.emit()
    if (!wasInfinite) this.persist()
  }

  setRemaining(value) {
    this.remaining = clamp(Math.round(Number(value) || 0), 0, DEFAULT_REMAINING)
    this.dirty = true
    this.saveLocal()
    this.emit()
    this.persist()
  }

  resetLocal() {
    this.remaining = DEFAULT_REMAINING
    this.infinite = false
    this.dirty = false
    this.saveLocal()
    this.setCloudState('local', '本地预览')
    this.emit()
  }

  async persist() {
    if (!this.dirty) return { ok: true }
    this.writeQueue = this.writeQueue.then(() => this.persistNow())
    return this.writeQueue
  }

  async persistNow() {
    if (!this.bridge.hasSdk || this.bridge.localPreview) {
      this.setCloudState('local', '本地预览')
      return { ok: false, reason: 'local' }
    }
    this.setCloudState('syncing', '上传中')
    const result = await this.bridge.writeCloud({
      [KEYS.remaining]: String(this.remaining),
      [KEYS.infinite]: this.infinite ? '1' : '0',
      [KEYS.updatedAt]: String(Date.now()),
    })
    if (result.ok) {
      this.dirty = false
      this.setCloudState('synced', '云存档')
      return { ok: true }
    }
    this.setCloudState(
      'error',
      result.reason === 'unsupported'
        ? '端内不可用'
        : result.error?.code === 307044
          ? '稍后再同步'
          : '离线存档',
    )
    return result
  }

  flush() {
    if (this.dirty) this.persist()
  }
}
