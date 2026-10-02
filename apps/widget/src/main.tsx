import { render } from 'preact'
import { WidgetApi } from './api'
import { App } from './app'
import { type PageApi, createPageApi } from './page-api'
import { PreviewBackend } from './preview'
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
 * The page talks to it through `window.MessagerieChat` — open it, prefill or send a
 * message, say who the visitor is, attach metadata, hear what happens (`page-api.ts`). Calls
 * made before the script loaded wait in `window.MessagerieChat = []`, then run in order.
 *
 * `data-preview="<inbox origin>"`: the widget in the inbox's editor — fed by the editor
 * through `postMessage`, from that origin only, and never by the chat server.
 */

declare global {
  interface Window {
    MessagerieChat?: PageApi | unknown[]
  }
}

const PRODUCT_NAME = 'Messagerie'

// Known only while this script runs: kept before waiting for the page to be ready.
const current = document.currentScript as HTMLScriptElement | null

// The page's object at once — what it queued before now runs once the widget is ready.
const page = createPageApi(window.MessagerieChat)
window.MessagerieChat = page.api

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
  const identity = script.dataset.identity ?? page.api.identity ?? null

  const host = document.createElement('div')
  host.id = 'messagerie-chat'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLES
  shadow.appendChild(style)
  const mount = document.createElement('div')
  shadow.appendChild(mount)

  const pageFont = window.getComputedStyle(document.body).fontFamily || null
  const editor = script.dataset.preview
  if (editor) {
    const preview = new PreviewBackend(editor)
    render(
      <App
        api={preview}
        identity={null}
        poweredBy={PRODUCT_NAME}
        pageFont={pageFont}
        bind={page.ready}
        emit={page.emit}
        watch={(onChange) => preview.watch(onChange)}
      />,
      mount,
    )
    return
  }
  render(
    <App
      api={new WidgetApi(base, site)}
      identity={identity}
      poweredBy={PRODUCT_NAME}
      pageFont={pageFont}
      bind={page.ready}
      emit={page.emit}
      page={page.page}
    />,
    mount,
  )
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
