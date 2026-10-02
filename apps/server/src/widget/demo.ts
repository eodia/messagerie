import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { siteSecrets } from '../db/schema.js'
import type { Settings } from '../settings/settings.js'
import { newSecret, signIdentity } from './tokens.js'

/**
 * Development only: a page of Acme Assurances with the widget on it — as a visitor, or as
 * Sophie Leroy signed in to her customer area, whose identity the page signs the way a
 * site's server would.
 */

async function siteSecret(db: Db, site: string): Promise<string> {
  const [found] = await db.select().from(siteSecrets).where(eq(siteSecrets.siteId, site))
  if (found) return found.identitySecret
  const secret = newSecret()
  await db
    .insert(siteSecrets)
    .values({ siteId: site, identitySecret: secret })
    .onConflictDoNothing()
  const [kept] = await db.select().from(siteSecrets).where(eq(siteSecrets.siteId, site))
  return kept?.identitySecret ?? secret
}

const SOPHIE = {
  sub: 'CLI-458732',
  name: 'Sophie Leroy',
  email: 'sophie.leroy@gmail.com',
  attributes: [
    { label: 'Numéro de client', value: 'CLI-458732', kind: 'code' },
    { label: 'Numéro de contrat', value: 'A123456', kind: 'code' },
    { label: 'Produit', value: 'Assurance Auto' },
    { label: 'Garanties', value: 'Tiers étendu' },
    { label: 'Statut du dossier', value: 'En cours', kind: 'status' },
    { label: 'Dernier sinistre', value: '2026-09-12', kind: 'date' },
  ],
}

const htmlEscape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

export async function demoPage(db: Db, settings: Settings, signedIn: boolean): Promise<string> {
  // Acme Assurances: the first active site of the settings.
  const site = (await settings.sites()).find((s) => s.active)?.id ?? 'acme'
  const identity = signedIn
    ? signIdentity(await siteSecret(db, site), {
        ...SOPHIE,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    : null
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acme Assurances — démonstration du widget</title>
<style>
  :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { margin: 0; background: #f8fafc; color: #0f172a; }
  header { display: flex; align-items: center; gap: 12px; padding: 16px 32px; background: #fff; border-bottom: 1px solid #e2e8f0; }
  .logo { width: 32px; height: 32px; border-radius: 8px; background: #2563eb; }
  header strong { font-size: 18px; }
  header nav { margin-left: auto; display: flex; gap: 8px; }
  header a { font-size: 14px; color: #334155; text-decoration: none; padding: 6px 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
  header a.on { background: #0f172a; color: #fff; border-color: #0f172a; }
  main { max-width: 960px; margin: 0 auto; padding: 56px 32px; }
  h1 { font-size: 40px; letter-spacing: -0.02em; margin: 0 0 12px; }
  p.lead { font-size: 18px; color: #475569; margin: 0 0 40px; max-width: 560px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; }
  .card h2 { font-size: 16px; margin: 0 0 6px; }
  .card p { font-size: 14px; color: #64748b; margin: 0; }
  .who { margin-top: 40px; font-size: 13px; color: #64748b; }
  .api { margin-top: 32px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; max-width: 640px; }
  .api h2 { font-size: 15px; margin: 0 0 4px; }
  .api p { font-size: 13px; color: #64748b; margin: 0 0 14px; }
  .api .buttons { display: flex; flex-wrap: wrap; gap: 8px; }
  .api button { font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; cursor: pointer; }
  .api button:hover { background: #eef2f7; }
  .api code { font-size: 12px; }
  .api ol { margin: 14px 0 0; padding-left: 18px; font-size: 12.5px; color: #475569; max-height: 140px; overflow: auto; }
</style>
</head>
<body>
<header>
  <span class="logo"></span><strong>Acme Assurances</strong>
  <nav>
    <a href="/demo" class="${signedIn ? '' : 'on'}">Visiteur anonyme</a>
    <a href="/demo?client=sophie" class="${signedIn ? 'on' : ''}">Connectée : Sophie Leroy</a>
  </nav>
</header>
<main>
  <h1>Votre assurance auto, simplement.</h1>
  <p class="lead">Déclarez un sinistre, suivez votre remboursement, téléchargez votre attestation : notre assistant vous répond à toute heure, nos conseillers en semaine.</p>
  <div class="cards">
    <div class="card"><h2>Déclarer un sinistre</h2><p>En ligne, en quelques minutes.</p></div>
    <div class="card"><h2>Suivre un remboursement</h2><p>Chaque étape de votre dossier.</p></div>
    <div class="card"><h2>Mon contrat</h2><p>Garanties, attestation, conducteurs.</p></div>
  </div>
  <p class="who">${
    signedIn
      ? 'Page de démonstration : le site a signé l’identité de Sophie Leroy (JWT HS256) avec le secret du site.'
      : 'Page de démonstration : visiteur anonyme — le widget se souvient de lui par un jeton qu’il garde.'
  }</p>
  <section class="api">
    <h2>L’API JavaScript du widget</h2>
    <p>Ce que la page du site peut faire avec <code>window.MessagerieChat</code> — chaque bouton appelle une fonction, et ce que le widget raconte s’inscrit dessous.</p>
    <div class="buttons">
      <button type="button" onclick="MessagerieChat.open()">open()</button>
      <button type="button" onclick="MessagerieChat.setMessage('Bonjour, je souhaite modifier mon contrat.'); MessagerieChat.open()">setMessage(…)</button>
      <button type="button" onclick="MessagerieChat.setUser({ name: 'Léa Martin', email: 'lea.martin@exemple.fr', phone: '06 12 34 56 78' })">setUser(…)</button>
      <button type="button" onclick="MessagerieChat.setContactData({ Abonnement: 'Formule Pro', 'Client depuis': 2019 })">setContactData(…)</button>
      <button type="button" onclick="MessagerieChat.setConversationData({ Page: location.pathname, Devis: 'Habitation T3', 'Montant (€)': 189 })">setConversationData(…)</button>
      <button type="button" onclick="MessagerieChat.send('Quel est le délai de remboursement ?')">send(…)</button>
      <button type="button" onclick="MessagerieChat.reset()">reset()</button>
      <button type="button" onclick="MessagerieChat.reset({ visitor: true })">reset({ visitor: true })</button>
      <button type="button" onclick="MessagerieChat.hide()">hide()</button>
      <button type="button" onclick="MessagerieChat.show()">show()</button>
    </div>
    <ol id="events"></ol>
  </section>
</main>
<script>
  // Queued before the widget loads, run once it is ready.
  window.MessagerieChat = window.MessagerieChat || []
  const told = (what) => (detail) => {
    const line = document.createElement('li')
    line.textContent = what + (detail && detail.body ? ' — ' + detail.body.slice(0, 80) : '')
    document.getElementById('events').prepend(line)
  }
  for (const event of ['ready', 'open', 'close', 'message:sent', 'message:received', 'reset']) {
    MessagerieChat.push(['on', event, told(event)])
  }
</script>
<script src="/widget.js" data-site="${htmlEscape(site)}"${identity ? ` data-identity="${htmlEscape(identity)}"` : ''} async></script>
</body>
</html>`
}
