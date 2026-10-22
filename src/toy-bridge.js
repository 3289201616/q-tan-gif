/**
 * Thin, defensive adapter around the official Bilibili Toy JS SDK.
 *
 * Only documented `window.toy` methods are used:
 * https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js
 *
 * The local preview fallbacks never pretend to be Bilibili data. They exist so
 * the interface can be developed outside the B站 container.
 */

import { isLocalPreview } from './utils.js'

const CLOUD_KEYS = {
  remaining: 'qt_remaining',
  infinite: 'qt_infinite',
  updatedAt: 'qt_updated_at',
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error('Toy SDK 响应超时')
        error.type = 'timeout'
        reject(error)
      }, ms)
    }),
  ])
}

function normalizeError(error) {
  if (!error) return { type: 'unknown', code: 0, message: '未知错误' }
  return {
    type: error.type || 'sdk_error',
    code: Number(error.code) || 0,
    message: error.message || String(error),
    raw: error,
  }
}

function isRateLimited(error) {
  return error?.type === 'http_error' && Number(error.code) === 307044
}

function pickFirstNumber(object, keys) {
  if (!object || typeof object !== 'object') return 0
  for (const key of keys) {
    const value = Number(object[key])
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

function extractAuthorMid(profile) {
  const root = profile?.data || profile
  if (!root) return 0
  return (
    pickFirstNumber(root, ['mid', 'uid', 'author_mid', 'authorMid']) ||
    pickFirstNumber(root.author, ['mid', 'uid']) ||
    pickFirstNumber(root.owner, ['mid', 'uid']) ||
    pickFirstNumber(root.up, ['mid', 'uid']) ||
    0
  )
}

export class ToyBridge {
  constructor() {
    this.sdk = typeof window !== 'undefined' ? window.toy || null : null
    this.localPreview = isLocalPreview()
    this.supportCache = new Map()
    this.containerState = null
  }

  get hasSdk() {
    return Boolean(this.sdk)
  }

  get envLabel() {
    if (!this.sdk) return '本地预览 · 云端模拟'
    if (this.localPreview) return '本地预览 · SDK 已连接'
    return 'B站官方 Toy SDK'
  }

  async isSupported(ability) {
    if (!this.sdk || typeof this.sdk.isSupport !== 'function') return false
    if (this.supportCache.has(ability)) return this.supportCache.get(ability)
    try {
      const supported = Boolean(await this.sdk.isSupport(ability))
      this.supportCache.set(ability, supported)
      return supported
    } catch {
      this.supportCache.set(ability, false)
      return false
    }
  }

  async readCloud(keys = [CLOUD_KEYS.remaining, CLOUD_KEYS.infinite, CLOUD_KEYS.updatedAt]) {
    if (!this.sdk || !(await this.isSupported('getCloudStorage'))) {
      return { ok: false, reason: 'unsupported', data: {} }
    }
    try {
      const data = await withTimeout(this.sdk.getCloudStorage(keys))
      return { ok: true, data: data && typeof data === 'object' ? data : {} }
    } catch (error) {
      return { ok: false, reason: 'error', error: normalizeError(error), data: {} }
    }
  }

  async writeCloud(values, { retry = true } = {}) {
    if (!this.sdk || !(await this.isSupported('setCloudStorage'))) {
      return { ok: false, reason: 'unsupported' }
    }
    const payload = { ...values }
    const attemptWrite = async () => {
      try {
        await withTimeout(this.sdk.setCloudStorage(payload))
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: 'error', error: normalizeError(error) }
      }
    }

    let result = await attemptWrite()
    if (result.ok || !retry || !isRateLimited(result.error)) return result

    // One rate-limited write gets two spaced retries. This is intentionally
    // unrolled instead of a tight loop, so the call pattern stays visible.
    await sleep(700)
    result = await attemptWrite()
    if (result.ok || !isRateLimited(result.error)) return result

    await sleep(1800)
    return attemptWrite()
  }

  async getAuthorRelation() {
    if (!this.sdk || !(await this.isSupported('getAuthorRelation'))) {
      return { ok: false, reason: 'unsupported', following: false }
    }
    try {
      const response = await withTimeout(this.sdk.getAuthorRelation())
      const data = response?.data || response
      const following = Boolean(
        data?.isFollowing ??
          data?.is_following ??
          data?.following ??
          data?.relation?.isFollowing ??
          response?.isFollowing,
      )
      const statusOk = !response?.status || response.status === 'ok'
      return {
        ok: statusOk,
        reason: statusOk ? '' : response.status || 'unknown',
        following,
        data,
      }
    } catch (error) {
      return { ok: false, reason: 'error', following: false, error: normalizeError(error) }
    }
  }

  async getAuthorProfile() {
    if (!this.sdk || !(await this.isSupported('getAuthorProfile'))) {
      return { ok: false, reason: 'unsupported', mid: 0, data: null }
    }
    try {
      const response = await withTimeout(this.sdk.getAuthorProfile())
      const data = response?.data || response
      return {
        ok: !response?.status || response.status === 'ok',
        mid: extractAuthorMid(response),
        data,
      }
    } catch (error) {
      return { ok: false, reason: 'error', mid: 0, data: null, error: normalizeError(error) }
    }
  }

  async openAuthorSpace(mid) {
    if (!this.sdk || !mid || !(await this.isSupported('navigate'))) {
      return { ok: false, reason: 'unsupported' }
    }
    try {
      await withTimeout(this.sdk.navigate({ type: 'space', id: String(mid), extra: { from: 'toy' } }))
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: 'error', error: normalizeError(error) }
    }
  }

  async saveImageToAlbum(base64Data, hintMsg = '需要相册权限，才能把 Q 弹动图保存下来') {
    if (!this.sdk || !(await this.isSupported('saveImageToAlbum'))) {
      return { ok: false, reason: 'unsupported' }
    }
    try {
      const result = await withTimeout(this.sdk.saveImageToAlbum({ base64Data, hintMsg }))
      return { ok: true, result }
    } catch (error) {
      return { ok: false, reason: 'error', error: normalizeError(error) }
    }
  }

  async share(path = 'index.html') {
    if (!this.sdk || !(await this.isSupported('share'))) {
      return { ok: false, reason: 'unsupported' }
    }
    try {
      await withTimeout(this.sdk.share({ path }))
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: 'error', error: normalizeError(error) }
    }
  }

  async getContainerState() {
    if (!this.sdk || !(await this.isSupported('getContainerState'))) return null
    try {
      const state = await this.sdk.getContainerState()
      this.containerState = state
      return state
    } catch {
      return null
    }
  }

  onContainerChange(listener) {
    if (!this.sdk || typeof this.sdk.onContainerChange !== 'function') return () => {}
    try {
      return this.sdk.onContainerChange(listener) || (() => {})
    } catch {
      return () => {}
    }
  }

  static get cloudKeys() {
    return CLOUD_KEYS
  }
}
