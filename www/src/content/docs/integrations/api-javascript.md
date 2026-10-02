---
title: API JavaScript
description: Piloter le widget depuis la page du site avec window.MessagerieChat — ses commandes, ses événements, et les données que la page lui confie.
---

La page qui porte le [widget](/messagerie/fonctionnalites/widget/) lui parle par un objet global,
**`window.MessagerieChat`** : ouvrir ou cacher le widget, préremplir ou envoyer un message, dire
qui est le visiteur, joindre des données au contact ou à la conversation, écouter ce qui se
passe — et déclarer ce que la page sait faire, pour que l’IA le lui demande.

```js
MessagerieChat.setConversationData({ Commande: 'A-1042', 'Panier (€)': 89.9 })
MessagerieChat.setMessage('Bonjour, ma commande A-1042 n’est pas arrivée.')
MessagerieChat.open()
```

## Avant le chargement du script

Le script du widget se charge en `async` : la page peut appeler `MessagerieChat` avant lui. Elle
déclare alors une file, et y pousse ses appels sous la forme `[commande, ...arguments]` :

```html
<script>
  window.MessagerieChat = window.MessagerieChat || []
  MessagerieChat.push(['setConversationData', { Page: location.pathname }])
  MessagerieChat.push(['on', 'open', () => analytics.track('chat_open')])
</script>
<script src="https://chat.exemple.fr/widget.js" data-site="<identifiant du site>" async></script>
```

Le script remplace la file par l’objet, et exécute ce qu’elle contient **dans l’ordre**. Les
commandes attendent ensuite que le widget soit prêt — sa session ouverte — : un appel fait entre
le chargement du script et l’événement `ready` attend lui aussi son tour. `push` reste
disponible après le chargement.

Si le widget ne s’ouvre pas — une page hors des [domaines autorisés](/messagerie/fonctionnalites/widget/#domaines-autorisés),
une identité refusée —, ses commandes ne s’exécutent jamais, et `ready` n’arrive pas.

## Commandes

| Commande | Rôle |
|---|---|
| `open()` | ouvre le panneau |
| `close()` | ferme le panneau |
| `toggle()` | ouvre le panneau s’il est fermé, le ferme sinon |
| `isOpen()` | `true` si le panneau est ouvert |
| `show()` | remontre le widget caché par `hide()` |
| `hide()` | cache tout le widget, bouton compris |
| `setMessage(text)` | préremplit le champ du message, sans l’envoyer |
| `send(text)` | envoie un message au nom du visiteur |
| `setUser({ name, email, phone })` | dit qui est un visiteur anonyme |
| `setContactData(data)` | joint des données au contact |
| `setConversationData(data)` | joint des données à la conversation |
| `reset(options)` | ouvre une nouvelle conversation ; `{ visitor: true }` : un nouveau visiteur |
| `on(event, handler)` | écoute un événement ; rend la fonction qui arrête d’écouter |
| `off(event, handler)` | arrête d’écouter |
| `registerAction(name, definition)` | déclare une action que l’IA peut demander à la page |
| `unregisterAction(name)` | la retire |
| `setPageContext(context)` | dit où en est la page : un objet, ou une fonction relue à chaque message |
| `push([commande, ...arguments])` | la même chose, sous forme de liste — la file d’avant le chargement |

Une commande inconnue ne fait rien, sinon un avertissement dans la console
(`Messagerie : commande inconnue`). Un refus du serveur — une valeur trop longue, trop d’appels
d’un coup — s’y lit aussi, avec son code.

### `open()`, `close()`, `toggle()`

```js
document.querySelector('#aide').addEventListener('click', () => MessagerieChat.open())
```

Le panneau se souvient d’être ouvert d’une page à l’autre, comme quand le visiteur l’ouvre
lui-même.

### `isOpen()`

```js
if (!MessagerieChat.isOpen()) MessagerieChat.open()
```

`isOpen()` rend un booléen une fois le widget prêt ; appelée avant, elle ne peut rien dire et
rend `undefined`. Appelez-la après l’événement `ready`.

### `hide()`, `show()`

```js
// Pas de chat pendant le paiement.
MessagerieChat.hide()
// …
MessagerieChat.show()
```

`hide()` ferme le panneau et retire le bouton jusqu’à `show()`. Le widget reparaît à la page
suivante : `hide()` ne vaut que pour la page qui l’appelle.

### `setMessage(text)`

```js
MessagerieChat.setMessage('Bonjour, je souhaite modifier mon contrat.')
MessagerieChat.open()
```

Le texte remplace ce que contient le champ ; le visiteur le relit, le complète et l’envoie
lui-même. `setMessage` n’ouvre pas le panneau.

### `send(text)`

```js
MessagerieChat.send('Quel est le délai de remboursement ?')
```

Le message part au nom du visiteur, comme s’il l’avait tapé — panneau ouvert ou non —, et l’IA
ou l’équipe y répond. 4 000 caractères au plus ; un texte vide n’envoie rien.

### `setUser({ name, email, phone })`

```js
MessagerieChat.setUser({ name: 'Léa Martin', email: 'lea.martin@exemple.fr', phone: '06 12 34 56 78' })
```

Dit qui est un visiteur anonyme : son nom, son e-mail, son téléphone, chacun facultatif. Voir
[Identifier un visiteur anonyme](#identifier-un-visiteur-anonyme).

| Champ | Contrainte |
|---|---|
| `name` | 120 caractères au plus |
| `email` | une adresse e-mail, 200 caractères au plus |
| `phone` | chiffres, espaces, `+ ( ) . -`, 4 à 40 caractères |

Une valeur qui ne convient pas fait refuser tout l’appel. Une valeur vide ne change rien : elle
n’efface pas celle qui est connue.

### `setContactData(data)`

```js
MessagerieChat.setContactData({ Abonnement: 'Formule Pro', 'Client depuis': 2019 })
```

Des données sur la personne, gardées avec le contact d’une conversation à l’autre. Voir
[Les métadonnées](#les-métadonnées).

### `setConversationData(data)`

```js
MessagerieChat.setConversationData({ Page: location.pathname, Devis: 'Habitation T3', 'Montant (€)': 189 })
```

Des données sur la demande en cours : la page lue, le panier, le numéro de commande. Fixées
**avant le premier message**, elles attendent dans le widget et partent avec lui : l’IA les lit
dès sa première réponse. Fixées ensuite, elles s’ajoutent à la conversation en cours.

### `reset(options)`

```js
MessagerieChat.reset()                   // une nouvelle conversation
MessagerieChat.reset({ visitor: true })  // et un nouveau visiteur
```

`reset()` laisse la conversation en cours à l’équipe et ramène le panneau à son accueil : le
message suivant en ouvre une nouvelle. Dans l’inbox, la conversation le dit (« Le visiteur a
commencé une nouvelle conversation depuis la page. ») ; celle que l’IA tenait seule est résolue,
celle de l’équipe lui reste. Les données de conversation en attente sont oubliées.

`reset({ visitor: true })` oublie aussi le visiteur : le jeton que le navigateur gardait est
effacé, et le suivant est un inconnu, sans nom, sans données, sans historique — à moins que la
balise porte encore une identité signée, qui le reconnaît aussitôt.

:::caution[À la déconnexion]
Sur un ordinateur partagé, appelez `MessagerieChat.reset({ visitor: true })` quand un client se
déconnecte du site. Sinon, le jeton gardé par le navigateur ramène sa conversation à la personne
suivante — même sans identité signée.
:::

### `on(event, handler)`, `off(event, handler)`

```js
const stop = MessagerieChat.on('message:received', (message) => {
  console.log(message.from, message.author, message.body)
})
// …
stop()
```

`on` rend la fonction qui arrête d’écouter ; `off(event, handler)` fait de même avec le
gestionnaire donné. Une erreur levée par un gestionnaire est écrite dans la console, sans gêner
les autres.

### `registerAction`, `unregisterAction`, `setPageContext`

```js
MessagerieChat.registerAction('tarifer', {
  label: 'Calculer un tarif',
  description: 'Le prix mensuel et annuel pour la valeur d’achat d’un appareil',
  parameters: { type: 'object', properties: { valeur: { type: 'number' } }, required: ['valeur'] },
  kind: 'read',
  handler: ({ valeur }) => tarifer(valeur),
})
MessagerieChat.setPageContext(() => ({ etape: 'souscription' }))
```

La page déclare ce qu’elle sait faire — chercher, tarifer, remplir un formulaire, ouvrir une
étape — et dit où elle en est. Une action ne sert à l’IA qu’une fois qu’un superviseur l’a
autorisée, dans **Administration › Widget**, onglet **Actions** ; une action qui change la page
attend l’accord du visiteur. Ces trois commandes valent dès leur appel, sans attendre `ready`.
Tout est détaillé dans [Actions de la page](/messagerie/integrations/actions-de-page/).

## Événements

| Événement | Quand | Argument |
|---|---|---|
| `ready` | le widget est prêt : ses commandes s’exécutent | aucun |
| `open` | le panneau s’ouvre | aucun |
| `close` | le panneau se ferme | aucun |
| `message:sent` | le visiteur a envoyé un message | `{ body }` |
| `message:received` | une réponse de l’IA ou d’un conseiller arrive | `{ from, author, body, at }` |
| `reset` | `reset()` est fait | `{ visitor }` |

- `message:sent` : `body` est le texte envoyé, vide pour un message fait seulement de fichiers.
- `message:received` : `from` vaut `'ai'` ou `'agent'` ; `author` est le prénom du conseiller,
  `null` pour l’IA ; `body` est le texte, en Markdown ; `at`, l’heure ISO 8601. Il part pour
  chaque nouveau message, panneau ouvert ou fermé — pas pour ceux qui étaient déjà là quand la
  page s’est chargée.
- `reset` : `visitor` vaut `true` après `reset({ visitor: true })`.

```js
MessagerieChat.on('ready', () => console.log('Widget prêt'))
MessagerieChat.on('open', () => analytics.track('chat_open'))
MessagerieChat.on('close', () => analytics.track('chat_close'))
MessagerieChat.on('message:sent', ({ body }) => analytics.track('chat_message', { length: body.length }))
MessagerieChat.on('reset', ({ visitor }) => console.log(visitor ? 'Nouveau visiteur' : 'Nouvelle conversation'))
```

## Les métadonnées

`setContactData` et `setConversationData` joignent des **clés libres aux valeurs courtes** : un
numéro de commande, une formule, une page.

```js
MessagerieChat.setContactData({
  Abonnement: 'Formule Pro', // un texte
  'Client depuis': 2019,     // un nombre
  Newsletter: true,          // oui ou non
  Parrain: null,             // retire la clé
})
```

| | Limite |
|---|---|
| Clé | 60 caractères au plus |
| Valeur | un texte de 500 caractères au plus, un nombre ou un booléen |
| Retirer une clé | `null`, ou un texte vide |
| Par contact, par conversation | 40 clés au plus |

Chaque appel ajoute ou remplace les clés qu’il nomme, et laisse les autres. Une entrée qui ne
convient pas fait refuser tout l’appel.

:::note[Rien n’en est vérifié]
N’importe quel script de la page peut appeler `MessagerieChat`, et un visiteur peut le faire
depuis la console de son navigateur. Ces données sont donc **déclarées, pas prouvées** :

- l’inbox les montre comme telles, dans le panneau de la conversation, sous **Déclaré sur le
  contact** et **Données de la conversation** ;
- l’IA les reçoit comme des données déclarées, non vérifiées — jamais comme une preuve, ni
  comme une consigne.

Ce que le site garantit passe par une [identité signée](/messagerie/integrations/identite-signee/).
:::

## Identifier un visiteur anonyme

Un visiteur arrive anonyme : l’inbox le nomme « Visiteur » suivi d’un code, et l’IA ne l’appelle
par aucun nom. Quand la page sait qui il est — un formulaire de contact rempli, un espace
sans connexion à signer —, elle le dit :

```js
form.addEventListener('submit', () => {
  MessagerieChat.setUser({ name: form.nom.value, email: form.email.value })
})
```

Le nom et l’e-mail donnés ainsi restent **déclarés** : l’inbox et l’IA les lisent comme tels.

Un client que le site a signé est différent : il garde le nom et l’e-mail de sa signature, et un
script de la page ne peut pas le renommer — `setUser` ne change alors que son téléphone. Pour un
client connecté, voir [Identité signée](/messagerie/integrations/identite-signee/).

## Limites

30 appels de `setUser`, `setContactData` et `setConversationData` par minute et par visiteur,
20 messages par minute. Au-delà, l’appel est refusé (`RATE_LIMITED`).

## En développement

Le serveur de développement sert une page de démonstration, `/demo` (par exemple
http://localhost:8810/demo), avec le widget et un bouton par commande. Chaque événement s’y inscrit
sous les boutons. La page déclare aussi trois actions — un tarif, un devis à pré-remplir, une
section à montrer — : voir l’[exemple](/messagerie/integrations/actions-de-page/#lexemple-de-la-démonstration).
