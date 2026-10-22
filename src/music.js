import { clamp, formatDuration, getStoredJSON, setStoredJSON } from './utils.js'

/**
 * One audio element drives both the soundtrack and the background video.
 * Browsers block audible autoplay, so the controller starts muted and quietly
 * upgrades to sound on the visitor's first gesture.
 */
export class MusicController {
  constructor(refs) {
    this.audio = refs.audio
    this.video = refs.video
    this.app = refs.app
    this.els = refs.els
    this.isPlaying = false
    this.isMuted = false
    this.userPaused = false
    this.firstGestureDone = false
    this.panelOpen = false
    this.volume = 0.68
    this.videoEnabled = true
    this.musicTimer = 0
    this.lastSavedVolume = 0.68
    this.prefersMuted = false

    const prefs = getStoredJSON('qtan_media_v1', {})
    if (Number.isFinite(Number(prefs.volume))) this.volume = clamp(Number(prefs.volume), 0.01, 1)
    if (typeof prefs.videoEnabled === 'boolean') this.videoEnabled = prefs.videoEnabled

    this.els.volumeRange.value = String(Math.round(this.volume * 100))
    this.audio.volume = this.volume
    this.audio.muted = Boolean(prefs.muted)
    this.prefersMuted = this.audio.muted
    this.video.muted = true
    this.audio.loop = true
    this.video.loop = true

    this.applyVideoState()
    this.bind()
    this.updateProgress()
    this.updateVolumeUI()
    this.setPanel(false)
  }

  bind() {
    const { els } = this

    this.audio.addEventListener('play', () => {
      this.isPlaying = true
      this.app.classList.add('is-music-playing')
      this.syncVideo()
      this.startTimer()
      this.updatePlayUI()
    })

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false
      this.app.classList.remove('is-music-playing')
      this.syncVideo()
      this.stopTimer()
      this.updatePlayUI()
    })

    this.audio.addEventListener('playing', () => {
      this.audioStatus('正在播放')
      this.updatePlayUI()
    })

    this.audio.addEventListener('waiting', () => this.audioStatus('缓冲中…'))
    this.audio.addEventListener('canplay', () => {
      if (this.isPlaying) this.audioStatus('正在播放')
    })

    this.audio.addEventListener('volumechange', () => {
      this.volume = this.audio.muted ? 0 : this.audio.volume
      if (!this.audio.muted && this.audio.volume > 0) this.lastSavedVolume = this.audio.volume
      this.updateVolumeUI()
      this.savePrefs()
    })

    this.audio.addEventListener('timeupdate', () => this.updateProgress())
    this.audio.addEventListener('durationchange', () => this.updateDuration())
    this.audio.addEventListener('loadedmetadata', () => this.updateDuration())

    this.video.addEventListener('error', () => {
      this.els.videoToggle.disabled = true
      this.els.videoToggle.title = '视频背景加载失败'
    })

    this.els.panelPlayButton.addEventListener('click', () => this.togglePlay())
    this.els.muteButton.addEventListener('click', () => this.toggleMute())
    this.els.musicButton.addEventListener('click', () => this.setPanel(!this.panelOpen))
    this.els.closeMusic.addEventListener('click', () => this.setPanel(false))
    this.els.seekRange.addEventListener('input', () => {
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.audio.currentTime = (Number(this.els.seekRange.value) / 100) * this.audio.duration
      }
    })
    this.els.volumeRange.addEventListener('input', () => {
      const value = Number(this.els.volumeRange.value) / 100
      this.audio.muted = value === 0
      this.audio.volume = value
      if (value > 0) this.lastSavedVolume = value
    })

    this.els.videoToggle.addEventListener('click', () => this.setVideoEnabled(!this.videoEnabled))
    this.els.videoToggleInPanel.addEventListener('click', () =>
      this.setVideoEnabled(!this.videoEnabled),
    )

    document.addEventListener(
      'pointerdown',
      (event) => {
        if (this.firstGestureDone) return
        this.firstGestureDone = true
        // Let the user's actual click happen first; starting audio inside the
        // same pointerdown is allowed by every modern mobile browser.
        this.primeAudio()
      },
      { capture: true },
    )

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.panelOpen) this.setPanel(false)
      if (
        event.code === 'Space' &&
        !this.panelOpen &&
        !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName || '') &&
        !document.querySelector('.modal.is-open')
      ) {
        event.preventDefault()
        this.togglePlay()
      }
    })

    document.addEventListener('pointerdown', (event) => {
      if (!this.panelOpen) return
      if (this.els.musicPanel.contains(event.target) || this.els.musicButton.contains(event.target)) return
      this.setPanel(false)
    })

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.video.pause()
      } else {
        this.syncVideo()
      }
    })
  }

  async init() {
    this.updateDuration()
    this.updatePlayUI()

    // Browser-safe autoplay: start muted (allowed by every mobile browser),
    // then try to upgrade to sound. If the upgrade is rejected the media
    // pauses; we immediately fall back to muted playback and ask for one tap.
    try {
      this.audio.muted = true
      this.isMuted = true
      await this.audio.play()
      this.audioStatus('自动播放中 · 轻触开声')
      this.els.musicStateNote.textContent = '点我开声'
      this.syncVideo()

      if (!this.prefersMuted) {
        this.audio.muted = false
        await new Promise((resolve) => setTimeout(resolve, 120))
        if (this.audio.paused) {
          this.audio.muted = true
          this.isMuted = true
          await this.audio.play().catch(() => {})
          this.audioStatus('自动播放中 · 轻触开声')
          this.els.musicStateNote.textContent = '点我开声'
        } else {
          this.isMuted = false
          this.audioStatus('正在播放')
          this.els.musicStateNote.textContent = '正在播放'
        }
      }
      this.updateVolumeUI()
      this.syncVideo()
      return
    } catch {
      /* all autoplay blocked, wait for a gesture */
    }

    this.audio.muted = true
    this.isMuted = true
    this.els.musicStateNote.textContent = '点击播放'
    this.audioStatus('等待播放')
    this.updatePlayUI()
    this.syncVideo()
  }

  async primeAudio() {
    if (this.userPaused || this.prefersMuted) return
    try {
      if (!this.audio.paused && !this.audio.muted) return
      this.audio.muted = false
      if (this.audio.volume === 0) this.audio.volume = this.lastSavedVolume || 0.68
      await this.audio.play()
      this.audioStatus('正在播放')
      this.els.musicStateNote.textContent = '正在播放'
      this.syncVideo()
    } catch {
      this.audioStatus('轻触播放按钮')
    }
  }

  async togglePlay() {
    this.userPaused = false
    this.prefersMuted = false
    if (this.audio.paused) {
      this.audio.muted = false
      if (this.audio.volume === 0) this.audio.volume = this.lastSavedVolume || 0.68
      try {
        await this.audio.play()
        this.audioStatus('正在播放')
        this.els.musicStateNote.textContent = '正在播放'
      } catch {
        this.els.musicStateNote.textContent = '点击播放'
        this.audioStatus('自动播放被拦截，请再点一次')
      }
    } else {
      this.audio.pause()
      this.userPaused = true
      this.els.musicStateNote.textContent = '已暂停'
      this.audioStatus('已暂停')
    }
    this.updatePlayUI()
    this.syncVideo()
  }

  toggleMute() {
    if (this.audio.muted || this.audio.volume === 0) {
      this.audio.muted = false
      this.audio.volume = this.lastSavedVolume || 0.68
    } else {
      this.audio.muted = true
    }
    this.updateVolumeUI()
  }

  setVolume(value) {
    const next = clamp(Number(value) || 0, 0, 1)
    this.audio.muted = next === 0
    this.audio.volume = next
    if (next > 0) this.lastSavedVolume = next
  }

  syncVideo() {
    if (!this.videoEnabled) {
      this.video.pause()
      return
    }
    if (this.isPlaying) {
      const promise = this.video.play()
      if (promise?.catch) promise.catch(() => {})
    } else {
      this.video.pause()
    }
  }

  setVideoEnabled(enabled) {
    this.videoEnabled = Boolean(enabled)
    this.applyVideoState()
    this.savePrefs()
    if (!this.videoEnabled) {
      this.video.pause()
    } else {
      this.syncVideo()
    }
  }

  applyVideoState() {
    this.app.dataset.video = this.videoEnabled ? 'on' : 'off'
    this.els.videoToggle.setAttribute('aria-pressed', String(this.videoEnabled))
    this.els.videoToggle.title = this.videoEnabled
      ? '关闭视频背景，切换为白色背景'
      : '开启视频背景'
    this.els.videoToggle.setAttribute(
      'aria-label',
      this.videoEnabled ? '关闭视频背景，切换为白色背景' : '开启视频背景',
    )
    this.els.videoToggle.innerHTML = this.videoEnabled
      ? '<svg class="icon"><use href="#i-video" /></svg><span class="video-toggle__label">视频背景</span><span class="video-toggle__track"><i></i></span>'
      : '<svg class="icon"><use href="#i-video-off" /></svg><span class="video-toggle__label">视频背景</span><span class="video-toggle__track"><i></i></span>'
    this.els.videoToggleInPanel.textContent = this.videoEnabled ? '关闭视频背景' : '开启视频背景'
  }

  setPanel(open) {
    this.panelOpen = Boolean(open)
    this.els.musicPanel.hidden = !this.panelOpen
    this.els.musicButton.setAttribute('aria-expanded', String(this.panelOpen))
    if (this.panelOpen) this.updateProgress()
  }

  updatePlayUI() {
    const playing = this.isPlaying && !this.audio.paused
    this.app.classList.toggle('is-music-playing', playing)
    if (!this.panelOpen && this.els.musicStateNote.textContent === '轻触开声') {
      // keep the prompt until sound is actually enabled
    }
    if (playing && !this.audio.muted) {
      this.els.musicStateNote.textContent = '正在播放'
      this.els.panelPlayButton.title = '暂停'
      this.els.musicButton.setAttribute('aria-label', '打开音乐播放器，当前正在播放')
    } else if (playing && this.audio.muted) {
      this.els.musicStateNote.textContent = '点我开声'
      this.els.panelPlayButton.title = '暂停'
    } else {
      this.els.musicStateNote.textContent = this.userPaused ? '已暂停' : '点击播放'
      this.els.panelPlayButton.title = '播放'
    }
  }

  updateProgress() {
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0
    const current = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0
    const percent = duration > 0 ? clamp((current / duration) * 100, 0, 100) : 0
    this.els.seekRange.value = String(percent)
    this.els.currentTime.textContent = formatDuration(current)
    this.els.totalTime.textContent = formatDuration(duration || 187.37)
    this.setRangeFill(this.els.seekRange, percent)
  }

  updateDuration() {
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0
    this.els.totalTime.textContent = formatDuration(duration || 187.37)
  }

  updateVolumeUI() {
    const muted = this.audio.muted || this.audio.volume === 0
    const value = muted ? 0 : Math.round(this.audio.volume * 100)
    this.els.volumeRange.value = String(value)
    this.els.volumeValue.textContent = `${value}%`
    this.els.muteButton.innerHTML = muted
      ? '<svg class="icon"><use href="#i-muted" /></svg>'
      : '<svg class="icon"><use href="#i-volume" /></svg>'
    this.els.muteButton.setAttribute('aria-label', muted ? '取消静音' : '静音')
    this.setRangeFill(this.els.volumeRange, value)
    this.isMuted = muted
  }

  setRangeFill(element, percent) {
    element.style.setProperty('--fill', `${clamp(percent, 0, 100)}%`)
  }

  startTimer() {
    this.stopTimer()
    this.musicTimer = window.setInterval(() => this.updateProgress(), 320)
  }

  stopTimer() {
    if (this.musicTimer) window.clearInterval(this.musicTimer)
    this.musicTimer = 0
  }

  audioStatus(text) {
    this.els.audioStatusText.textContent = text
  }

  savePrefs() {
    setStoredJSON('qtan_media_v1', {
      volume: this.audio.volume || this.lastSavedVolume,
      muted: this.audio.muted,
      videoEnabled: this.videoEnabled,
    })
  }

  destroy() {
    this.stopTimer()
  }
}
