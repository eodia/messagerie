import { render } from 'preact'
import { WidgetApi } from './api'
import { App, type Controls } from './app'
import { STYLES } from './styles'

/**
 * The widget, as a site embeds it:
 *
 *   <script src="https://chat.exemple.fr/widget.js" data-site="<site id>" async></script>
 *
 * `data-identity` carries the identity the site signed for a customer signed in to it
 * (a JWT, HS256, with the site's secret). The widget lives in a shadow root: the page's
 * styles do not reach it, and its own reach nothing of the page.
 *
 * The page may open and close it: `window.MessagerieChat.open()`, `.close()`.
 */

declare global {
  interface Window {
    MessagerieChat?: Partial<Controls> & { identity?: string }
  }
}

const PRODUCT_NAME = 'Messagerie'

// Known only while this script runs: kept before waiting for the page to be ready.
const current = document.currentScript as HTMLScriptElement | null

function start(): void {
  const script =
    current ?? document.querySelector<HTMLScriptElement>('script[data-site][src*="widget.js"]')
  const site = script?.dataset.site
  if (!script || !site) {
    console.warn('Messagerie : data-site manque sur la balise <script> du widget.')
    return
  }
  if (document.getElementById('messagerie-chat')) return

  // The server that served the script is the one the widget talks to.
  const base = script.dataset.api ?? new URL(script.src, window.location.href).origin
  const identity = script.dataset.identity ?? window.MessagerieChat?.identity ?? null

  const host = document.createElement('div')
  host.id = 'messagerie-chat'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLES
  shadow.appendChild(style)
  const mount = document.createElement('div')
  shadow.appendChild(mount)

  const bind = (controls: Controls) => {
    window.MessagerieChat = { ...window.MessagerieChat, ...controls }
  }
  render(
    <App
      api={new WidgetApi(base, site)}
      identity={identity}
      poweredBy={PRODUCT_NAME}
      bind={bind}
    />,
    mount,
  )
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
