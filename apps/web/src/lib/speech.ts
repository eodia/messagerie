'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { ApiFailure, api } from './api'
import { intlLocale } from './i18n'
import { plainOf } from './rich-text'

/**
 * The inbox's voice, in audio mode:
 *
 * - a message read aloud — by the server's AI voice (Mistral's Voxtral TTS), or by the
 *   browser's (`speechSynthesis`) where the server has none —, on demand, and each new
 *   message of the visitor in the conversation open, as it arrives;
 * - a reply dictated by the browser (`SpeechRecognition`), where it has it — Chrome and
 *   Edge recognise the voice on their maker's servers, which the button says.
 */

const AUDIO_KEY = 'chat.audio'

interface SpeechState {
  /** What is being read, by its key — a message's id. */
  readonly speaking: string | null
  /** The audio mode: messages read aloud, replies dictated. */
  readonly audioMode: boolean
  setAudioMode: (on: boolean) => void
  /** Reads a message aloud — `key` is its id, which the server's voice reads it by. */
  speak: (key: string, markdown: string) => void
  stop: () => void
}

export const canSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window

/** The best voice of the language — a natural one when the system has it. */
function voiceFor(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  const base = lang.slice(0, 2).toLowerCase()
  const ours = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
  return (
    ours.find(
      (v) => /natural|neural|google/i.test(v.name) && v.lang.toLowerCase() === lang.toLowerCase(),
    ) ??
    ours.find((v) => /natural|neural|google/i.test(v.name)) ??
    ours.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ??
    ours[0] ??
    null
  )
}

function storedAudio(): boolean {
  try {
    return window.localStorage.getItem(AUDIO_KEY) === 'on'
  } catch {
    return false
  }
}

/** The server has no voice: the browser's reads, for the rest of the page. */
let browserOnly = false
/** The sound being played, and the ones heard already — read again without asking. */
let playing: HTMLAudioElement | null = null
const heard = new Map<string, string>()

function remember(key: string, url: string): void {
  heard.set(key, url)
  if (heard.size <= 30) return
  const [oldest, address] = heard.entries().next().value as [string, string]
  URL.revokeObjectURL(address)
  heard.delete(oldest)
}

export const useSpeech = create<SpeechState>((set, get) => {
  const done = (key: string) => () => {
    if (get().speaking === key) set({ speaking: null })
  }

  function browserSays(key: string, markdown: string): void {
    if (!canSpeak()) {
      set({ speaking: null })
      return
    }
    const text = plainOf(markdown).trim()
    if (text === '') {
      set({ speaking: null })
      return
    }
    const lang = intlLocale()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    const voice = voiceFor(lang)
    if (voice) utterance.voice = voice
    utterance.onend = done(key)
    utterance.onerror = done(key)
    window.speechSynthesis.speak(utterance)
  }

  return {
    speaking: null,
    audioMode: typeof window === 'undefined' ? false : storedAudio(),

    setAudioMode: (audioMode) => {
      set({ audioMode })
      try {
        window.localStorage.setItem(AUDIO_KEY, audioMode ? 'on' : 'off')
      } catch {
        // For this page only.
      }
      if (!audioMode) get().stop()
    },

    speak: (key, markdown) => {
      get().stop()
      set({ speaking: key })
      if (browserOnly) {
        browserSays(key, markdown)
        return
      }
      const known = heard.get(key)
      const sound = known
        ? Promise.resolve(known)
        : api.speech(key).then((blob) => {
            const url = URL.createObjectURL(blob)
            remember(key, url)
            return url
          })
      sound
        .then((url) => {
          // Another message asked meanwhile, or stopped.
          if (get().speaking !== key) return
          const audio = new Audio(url)
          playing = audio
          audio.onended = done(key)
          audio.onerror = done(key)
          return audio.play()
        })
        .catch((failure: unknown) => {
          if (get().speaking !== key) return
          if (
            failure instanceof ApiFailure &&
            (failure.code === 'SPEECH_UNAVAILABLE' || failure.code === 'AI_UNAVAILABLE')
          ) {
            browserOnly = failure.code === 'SPEECH_UNAVAILABLE'
          }
          browserSays(key, markdown)
        })
    },

    stop: () => {
      playing?.pause()
      playing = null
      if (canSpeak()) window.speechSynthesis.cancel()
      set({ speaking: null })
    },
  }
})

// ── Dictation ─────────────────────────────────────────────────────────────────────────

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult:
    | ((event: {
        readonly resultIndex: number
        readonly results: ArrayLike<{
          readonly isFinal: boolean
          readonly 0: { readonly transcript: string }
        }>
      }) => void)
    | null
  onerror: ((event: { readonly error: string }) => void) | null
  onend: (() => void) | null
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition
    webkitSpeechRecognition?: new () => Recognition
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const canDictate = (): boolean => recognitionClass() !== null

/**
 * The voice, written: `onText` receives each phrase once the browser settled it; `heard` is
 * what it is still hearing. Stops by itself after a silence, or when asked.
 */
export function useDictation(onText: (text: string) => void): {
  readonly listening: boolean
  readonly heard: string
  readonly error: string | null
  readonly toggle: () => void
} {
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const [error, setError] = useState<string | null>(null)
  const running = useRef<Recognition | null>(null)
  const latest = useRef(onText)
  latest.current = onText

  const stop = useCallback(() => {
    running.current?.stop()
  }, [])

  const start = useCallback(() => {
    const Recognition = recognitionClass()
    if (!Recognition) return
    const recognition = new Recognition()
    recognition.lang = intlLocale()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result) continue
        const text = result[0].transcript
        if (result.isFinal) latest.current(text.trim())
        else interim += text
      }
      setHeard(interim)
    }
    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') setError(event.error)
    }
    recognition.onend = () => {
      running.current = null
      setListening(false)
      setHeard('')
    }
    running.current = recognition
    setError(null)
    setListening(true)
    recognition.start()
  }, [])

  // Leaving the conversation stops the microphone.
  useEffect(() => () => running.current?.abort(), [])

  return {
    listening,
    heard,
    error,
    toggle: () => (running.current ? stop() : start()),
  }
}
