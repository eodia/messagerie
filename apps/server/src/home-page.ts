/**
 * The server's own address, opened in a browser: not the inbox — which the agents use, on
 * its own address — but where to find it, and what this server serves.
 */

const htmlEscape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

export function homePage(inboxUrl: string, production: boolean): string {
  const inbox = htmlEscape(inboxUrl)
  const demo = production
    ? ''
    : `<li><a href="/demo">/demo</a><span>Un site de démonstration avec le widget — en visiteur, ou en cliente connectée.</span></li>`
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Serveur de la messagerie</title>
<style>
  :root { color-scheme: light dark; --ink: #18181b; --muted: #71717a; --line: #e4e4e7; --bg: #fafafa; --card: #fff; --accent: #16a34a; }
  @media (prefers-color-scheme: dark) { :root { --ink: #f4f4f5; --muted: #a1a1aa; --line: #27272a; --bg: #09090b; --card: #18181b; --accent: #22c55e; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--bg); color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 560px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  p { margin: 0 0 20px; color: var(--muted); font-size: 14px; line-height: 1.5; }
  .go { display: inline-block; padding: 9px 16px; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 600; font-size: 14px; text-decoration: none; }
  ul { list-style: none; margin: 24px 0 0; padding: 18px 0 0; border-top: 1px solid var(--line); display: grid; gap: 10px; }
  li { display: grid; grid-template-columns: 7.5rem 1fr; gap: 12px; font-size: 13px; }
  li a { font-family: ui-monospace, monospace; color: var(--ink); }
  li span { color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Serveur de la messagerie</h1>
  <p>Cette adresse sert l’API, le widget et ses aperçus. Les conseillers travaillent dans l’inbox, à son adresse à elle.</p>
  <a class="go" href="${inbox}">Ouvrir l’inbox</a>
  <ul>
    ${demo}
    <li><a href="/widget.js">/widget.js</a><span>Le script que les sites intègrent.</span></li>
    <li><a href="/health">/health</a><span>L’état du serveur, pour la supervision.</span></li>
  </ul>
</main>
</body>
</html>`
}
