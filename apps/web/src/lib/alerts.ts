import type { AlertKind } from '@chat/contracts'
import { useAlertSettings } from './store/alert-settings'
import { titleCount } from './title'

/**
 * How the inbox gets an agent's attention: a chime, a notification of the desktop when
 * the tab is behind others, and a count on the tab and its icon.
 */

let audio: AudioContext | null = null

/**
 * Browsers mute a page until someone interacts with it: the audio context is made on the
 * first click or key, and the chime plays from then on.
 */
export function unlockSound(): () => void {
  const unlock = () => {
    audio ??= new AudioContext()
    void audio.resume()
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
  return () => {
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
}

/**
 * Two notes for a visitor's message, three rising for what is handed to the agent — told
 * apart without looking. Synthesized: no file to load, nothing to fail.
 */
const CHIMES: Record<AlertKind, readonly number[]> = {
  visitor_message: [880, 1318.5],
  handoff: [659.3, 880, 1318.5],
  assigned: [659.3, 880, 1318.5],
  transferred: [659.3, 880, 1318.5],
}

export function chime(kind: AlertKind): void {
  if (!useAlertSettings.getState().sound || audio === null || audio.state !== 'running') return
  const start = audio.currentTime + 0.02
  CHIMES[kind].forEach((frequency, index) => {
    if (audio === null) return
    const at = start + index * 0.13
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(0.18, at + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start(at)
    oscillator.stop(at + 0.42)
  })
}

/** Whether the agent is looking at the inbox right now. */
export const inView = (): boolean => document.visibilityState === 'visible' && document.hasFocus()

/**
 * A notification of the desktop, when the agent is elsewhere. One per conversation: a
 * second message replaces the first rather than piling up.
 */
export function notifyDesktop(
  title: string,
  body: string,
  conversationId: string,
  onClick: () => void,
): void {
  if (!useAlertSettings.getState().desktop || inView()) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const notification = new Notification(title, {
    body,
    tag: `conversation-${conversationId}`,
    icon: '/icon.svg',
  })
  notification.onclick = () => {
    window.focus()
    onClick()
    notification.close()
  }
}

/**
 * The count on the tab — « (3) Messagerie » — and a dot on its icon, so that a tab among
 * twenty says it has something waiting.
 */
export function showWaiting(count: number): void {
  titleCount(count)
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) return
  link.dataset.plain ??= link.href
  link.href = count > 0 ? badgedIcon() : link.dataset.plain
}

/** The icon of `app/icon.svg`, with basedb's green dot in its corner. */
function badgedIcon(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#143D2B"/><path d="M20 16h24a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7H32l-10 8v-8h-2a7 7 0 0 1-7-7V23a7 7 0 0 1 7-7z" fill="#D9F5B5"/><circle cx="50" cy="14" r="13" fill="#2DA31E" stroke="#fff" stroke-width="4"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
