import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_RETRO_TIMER_DURATION_SECONDS,
  MIN_RETRO_TIMER_DURATION_SECONDS,
  currentRetroTimerSeconds,
  formatRetroTimerSeconds,
  type RetroTimerCommand,
  type RetroTimerDTO,
  type RetroTimerMode,
} from '@legends/shared'

const AUDIO_PREF_KEY = 'legends:retro:ambientAudio:v1'
const RETRO_MUSIC_SRC = '/sounds/retro-sound.mp3'

interface AudioPrefs {
  volume: number
  muted: boolean
}

function loadAudioPrefs(): AudioPrefs {
  if (typeof window === 'undefined') return { volume: 0.35, muted: false }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUDIO_PREF_KEY) ?? '') as Partial<AudioPrefs>
    return {
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 0.35,
      muted: Boolean(parsed.muted),
    }
  } catch {
    return { volume: 0.35, muted: false }
  }
}

function storeAudioPrefs(prefs: AudioPrefs): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify(prefs))
}

function playAudio(audio: HTMLAudioElement, onPlay: () => void, onBlocked: () => void): void {
  const result = audio.play()
  if (result && typeof result.then === 'function') {
    void result.then(onPlay).catch(onBlocked)
    return
  }
  if (!audio.paused) onPlay()
}

function useAmbientAudio(active: boolean, prefs: AudioPrefs): { ring: () => void } {
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const oscillatorsRef = useRef<Set<OscillatorNode>>(new Set())
  const [blocked, setBlocked] = useState(false)
  const [resumeAttempt, setResumeAttempt] = useState(0)
  const soundEnabled = !prefs.muted && prefs.volume > 0

  function ensureAudio() {
    const AudioCtor = window.AudioContext ?? window.webkitAudioContext
    if (!AudioCtor) return null
    if (!ctxRef.current) {
      const ctx = new AudioCtor()
      const gain = ctx.createGain()
      gain.gain.value = prefs.muted ? 0 : prefs.volume * 0.16
      gain.connect(ctx.destination)
      ctxRef.current = ctx
      gainRef.current = gain
    }
    return { ctx: ctxRef.current, gain: gainRef.current }
  }

  function stopAudio() {
    const music = musicRef.current
    if (music) {
      music.pause()
      music.currentTime = 0
    }
    for (const osc of oscillatorsRef.current) {
      try {
        osc.stop()
      } catch {
        // O oscilador pode já ter parado entre o snapshot e o stop.
      }
    }
    oscillatorsRef.current.clear()
  }

  useEffect(() => {
    storeAudioPrefs(prefs)
    if (musicRef.current) {
      musicRef.current.muted = prefs.muted
      musicRef.current.volume = prefs.volume
    }
    if (gainRef.current) gainRef.current.gain.value = prefs.muted ? 0 : prefs.volume * 0.24
  }, [prefs])

  useEffect(() => {
    if (!active || !soundEnabled) return
    if (!musicRef.current) {
      const music = new Audio(RETRO_MUSIC_SRC)
      music.loop = true
      music.preload = 'auto'
      musicRef.current = music
    }
    const music = musicRef.current
    music.muted = prefs.muted
    music.volume = prefs.volume
    playAudio(music, () => setBlocked(false), () => setBlocked(true))

    return () => {
      music.pause()
    }
  }, [active, soundEnabled, resumeAttempt])

  useEffect(() => {
    if (active && soundEnabled) return
    stopAudio()
    void ctxRef.current?.suspend().catch(() => {})
  }, [active, soundEnabled])

  useEffect(() => {
    if (!active || !soundEnabled || !blocked) return
    const resumeOnGesture = () => {
      const music = musicRef.current
      if (!music) return
      playAudio(music, () => {
        if (!music.paused) {
          setBlocked(false)
          setResumeAttempt((n) => n + 1)
        }
      }, () => setBlocked(true))
    }
    window.addEventListener('pointerdown', resumeOnGesture, { once: true })
    window.addEventListener('keydown', resumeOnGesture, { once: true })
    return () => {
      window.removeEventListener('pointerdown', resumeOnGesture)
      window.removeEventListener('keydown', resumeOnGesture)
    }
  }, [active, blocked, soundEnabled])

  return {
    ring: () => {
      if (prefs.muted || prefs.volume <= 0) return
      const audio = ensureAudio()
      if (!audio?.ctx || !audio.gain) return
      const { ctx, gain } = audio
      void ctx.resume().then(() => {
        if (ctx.state !== 'running') return
        const start = ctx.currentTime
        const notes = [880, 1174.66, 1567.98]
        notes.forEach((freq, index) => {
          const osc = ctx.createOscillator()
          const noteGain = ctx.createGain()
          osc.type = 'triangle'
          osc.frequency.setValueAtTime(freq, start + index * 0.16)
          noteGain.gain.setValueAtTime(0.001, start + index * 0.16)
          noteGain.gain.exponentialRampToValueAtTime(1.1, start + index * 0.16 + 0.025)
          noteGain.gain.exponentialRampToValueAtTime(0.001, start + index * 0.16 + 0.42)
          osc.connect(noteGain).connect(gain)
          oscillatorsRef.current.add(osc)
          osc.onended = () => oscillatorsRef.current.delete(osc)
          osc.start(start + index * 0.16)
          osc.stop(start + index * 0.16 + 0.45)
        })
      })
    },
  }
}

function durationToMinutes(durationSeconds: number | null): number {
  return Math.max(1, Math.round((durationSeconds ?? 10 * 60) / 60))
}

export function RetroTimerPanel({
  timer,
  canControl,
  busy,
  error,
  onCommand,
}: {
  timer: RetroTimerDTO
  canControl: boolean
  busy: boolean
  error?: string | null
  onCommand: (command: RetroTimerCommand) => void
}) {
  const [tick, setTick] = useState(0)
  const [mode, setMode] = useState<RetroTimerMode>(timer.mode)
  const [minutes, setMinutes] = useState(durationToMinutes(timer.durationSeconds))
  const lastRingKey = useRef<string | null>(null)
  const clockOffsetRef = useRef(0)
  const lastServerNowRef = useRef<string | null>(null)

  // O cronômetro é contado a partir de `startedAt`, que é hora do servidor. Medir o
  // decorrido com o relógio da máquina do usuário erra o tempo todo pela diferença
  // entre os dois — e, no regressivo, toca o sino fora de hora. `serverNow` vem no
  // DTO justamente pra corrigir isso. Derivado no render pra já valer na 1ª pintura.
  if (lastServerNowRef.current !== timer.serverNow) {
    lastServerNowRef.current = timer.serverNow
    const serverNowMs = new Date(timer.serverNow).getTime()
    clockOffsetRef.current = Number.isFinite(serverNowMs) ? serverNowMs - Date.now() : 0
  }

  useEffect(() => {
    setMode(timer.mode)
    setMinutes(durationToMinutes(timer.durationSeconds))
  }, [timer.mode, timer.durationSeconds])

  useEffect(() => {
    if (timer.status !== 'running') return
    const id = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [timer.status])

  const seconds = useMemo(() => currentRetroTimerSeconds(timer, Date.now() + clockOffsetRef.current), [timer, tick])
  const durationSeconds = mode === 'countdown' ? Math.min(MAX_RETRO_TIMER_DURATION_SECONDS, Math.max(MIN_RETRO_TIMER_DURATION_SECONDS, minutes * 60)) : null
  const finished = timer.mode === 'countdown' && timer.status === 'running' && seconds <= 0
  const effectiveStatus = finished ? 'idle' : timer.status
  const running = effectiveStatus === 'running'
  const paused = effectiveStatus === 'paused'
  const musicActive = running
  const [audioPrefs, setAudioPrefs] = useState<AudioPrefs>(() => loadAudioPrefs())
  const audio = useAmbientAudio(musicActive, audioPrefs)
  const ring = audio.ring

  useEffect(() => {
    if (timer.mode !== 'countdown' || timer.status !== 'running' || seconds > 0) return
    const key = `${timer.startedAt ?? timer.updatedAt}:${timer.durationSeconds ?? 0}`
    if (lastRingKey.current === key) return
    lastRingKey.current = key
    ring()
  }, [ring, seconds, timer.durationSeconds, timer.mode, timer.startedAt, timer.status, timer.updatedAt])

  function startOrConfigure(action: 'start' | 'reset' | 'configure') {
    if (action === 'configure') onCommand({ action: 'configure', mode, durationSeconds })
    if (action === 'start') onCommand({ action: 'start', mode, durationSeconds })
    if (action === 'reset') onCommand({ action: 'reset', mode, durationSeconds })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-outline-variant/40 bg-surface-container px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="font-label text-label-sm text-on-surface-variant">Cronômetro</span>
        <div className="min-w-[92px] font-mono text-title-lg font-bold tabular-nums text-on-surface" aria-label="Cronômetro">
          {formatRetroTimerSeconds(seconds)}
        </div>
      </div>

      {canControl && effectiveStatus === 'idle' && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={mode === 'elapsed'}
            onClick={() => setMode('elapsed')}
            className={`rounded-md px-2 py-1 font-label text-label-sm ${mode === 'elapsed' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'}`}
          >
            Crescente
          </button>
          <button
            type="button"
            aria-pressed={mode === 'countdown'}
            onClick={() => setMode('countdown')}
            className={`rounded-md px-2 py-1 font-label text-label-sm ${mode === 'countdown' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'}`}
          >
            Regressivo
          </button>
          {mode === 'countdown' && (
            <input
              aria-label="Minutos do cronômetro"
              type="number"
              min={1}
              max={180}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value) || 1)}
              className="h-8 w-16 rounded-md border border-outline-variant/60 bg-surface px-2 text-label-sm text-on-surface"
            />
          )}
        </div>
      )}

      {canControl && (
        <div className="flex items-center gap-1">
          {running ? (
            <button type="button" disabled={busy} onClick={() => onCommand({ action: 'pause' })} className="rounded-md bg-primary px-3 py-1.5 font-label text-label-sm font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant">
              Pausar
            </button>
          ) : paused ? (
            <button type="button" disabled={busy} onClick={() => onCommand({ action: 'resume' })} className="rounded-md bg-primary px-3 py-1.5 font-label text-label-sm font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant">
              Retomar
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => startOrConfigure('start')} className="rounded-md bg-primary px-3 py-1.5 font-label text-label-sm font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant">
              Iniciar
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => startOrConfigure('reset')} className="rounded-md border border-outline-variant/50 px-3 py-1.5 font-label text-label-sm text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50">
            Zerar
          </button>
          {effectiveStatus === 'idle' && (
            <button type="button" disabled={busy} onClick={() => startOrConfigure('configure')} className="rounded-md border border-outline-variant/50 px-3 py-1.5 font-label text-label-sm text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50">
              Aplicar
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-l border-outline-variant/50 pl-2">
        <button
          type="button"
          aria-label={audioPrefs.muted ? 'Ativar som' : 'Mutar som'}
          aria-pressed={audioPrefs.muted}
          onClick={() => setAudioPrefs((p) => ({ ...p, muted: !p.muted }))}
          className="rounded-md border border-outline-variant/50 px-2 py-1 font-label text-label-sm text-on-surface-variant hover:bg-surface-container-highest"
        >
          {audioPrefs.muted ? 'Mudo' : 'Som'}
        </button>
        <input
          aria-label="Volume da música"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={audioPrefs.volume}
          onChange={(e) => setAudioPrefs((p) => ({ ...p, volume: Number(e.target.value), muted: false }))}
          className="w-20 accent-primary"
        />
      </div>

      {error && (
        <p role="alert" className="w-full font-label text-label-sm text-error">
          {error}
        </p>
      )}
    </div>
  )
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
