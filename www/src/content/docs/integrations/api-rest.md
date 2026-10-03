---
title: API REST
description: Lire les conversations, y répondre et les ranger depuis un programme, avec un jeton `msg_…`.
---

L’API REST ouvre la Messagerie aux programmes : un script, une synchronisation avec un CRM, un
outil d’automatisation. Elle répond sous `/api/v1`, sur le serveur du chat, et passe par les
**mêmes fonctions que l’inbox** : une réponse envoyée par l’API apparaît aussitôt aux
conseillers et part au visiteur.

```text
https://chat.exemple.fr/api/v1
```

L’adresse exacte de votre serveur est affichée, prête à copier, dans **Administration › API et
MCP**. Les mêmes jetons ouvrent le [serveur MCP](/messagerie/integrations/mcp/), pour un agent
IA. Pour être prévenu de ce qui se passe plutôt que de le demander, voyez les
[webhooks](/messagerie/integrations/webhooks/).

## Un jeton

Un jeton se crée dans **Administration › API et MCP**, onglet **Jetons**, bouton **Nouveau jeton**.
Seuls les superviseurs les gèrent ; un conseiller lit « Les jetons se gèrent par les
superviseurs. ».

| Champ | Ce qu’il règle |
|---|---|
| **À quoi sert ce jeton ?** | Son nom, 200 caractères au plus. C’est aussi le nom qui signe ce qu’il écrit. |
| **Accès** | **API REST**, **MCP**, ou les deux. Pris sur une porte qu’il n’ouvre pas, il est refusé. |
| **Droits** | **Lecture seule** : lire les conversations, les contacts, chercher. **Lecture et écriture** : aussi répondre, noter, affecter, résoudre, étiqueter. |
| **Boîtes de réception** | **Toutes**, ou **Certaines**, choisies une à une. |
| **Validité** | **Sans expiration**, **30 jours**, **90 jours**, **180 jours** ou **1 an**. |

:::caution[Affiché une fois]
À sa création, le jeton s’affiche dans la fenêtre **Jeton créé**, avec des exemples prêts à
copier. Copiez-le avant **J’ai copié le jeton** : il ne sera plus jamais affiché. La Messagerie
n’en garde que l’empreinte ; un jeton perdu ne se retrouve pas, il se remplace.
:::

### Sa forme

Un jeton s’écrit `msg_<préfixe>_<secret>` : un préfixe de huit caractères gardé en clair, qui le
distingue dans la liste (`msg_k3v9x2ma…`), puis un secret de 43 caractères tiré de 32 octets
aléatoires. Seul le SHA-256 du secret est conservé.

Gardez-le dans une variable d’environnement, `MESSAGERIE_TOKEN`, plutôt que dans un fichier, un
dépôt ou un message :

```bash
export MESSAGERIE_TOKEN="msg_k3v9x2ma_…"
```

### Ses droits

Aucun jeton ne **supprime** quoi que ce soit, et aucun ne gère les jetons : un jeton n’atteint
jamais `/api/inbox`, l’API de l’inbox.

| Droits | Permet |
|---|---|
| **Lecture seule** | Lire les conversations, les contacts, les boîtes, les conseillers ; chercher dans les messages. |
| **Lecture et écriture** | Aussi répondre au visiteur, écrire une note interne, affecter, résoudre, poser et retirer une étiquette. |

Une écriture demandée avec un jeton en lecture seule est refusée (`TOKEN_READ_ONLY`).

### Ses boîtes

Un jeton n’atteint jamais plus que son créateur : ses boîtes sont celles qu’il a cochées,
**parmi celles que voit son créateur**. Un superviseur voit toutes les boîtes ; un jeton qu’il
crée avec **Toutes** les atteint donc toutes.

Pour le jeton, une conversation d’une autre boîte n’existe pas (`CONVERSATION_NOT_FOUND`), ni un
contact qui n’a jamais écrit dans l’une des siennes (`CONTACT_NOT_FOUND`).

### Sa vie

- **Révocation** : bouton **Révoquer** de la liste. Ce qui utilise le jeton est refusé dès
  maintenant (`TOKEN_REVOKED`) ; cela ne se défait pas.
- **Expiration** : passée sa date, le jeton est refusé (`TOKEN_EXPIRED`). Les jetons révoqués ou
  expirés restent visibles sous la liste, repliés.
- **Créateur** : si son créateur n’est plus conseiller actif, le jeton est refusé
  (`TOKEN_INVALID`).
- **Dernière utilisation** : la liste dit « utilisé le … » ; la date est notée au plus toutes
  les cinq minutes.

## S’authentifier

Chaque requête porte le jeton dans l’en-tête `Authorization` :

```http
Authorization: Bearer msg_k3v9x2ma_…
```

Le premier appel à faire : demander ce que peut le jeton.

```bash
curl https://chat.exemple.fr/api/v1/me \
  -H "Authorization: Bearer $MESSAGERIE_TOKEN"
```

```json title="200 OK"
{
  "data": {
    "label": "Synchronisation CRM",
    "prefix": "msg_k3v9x2ma",
    "access": "write",
    "surfaces": ["rest", "mcp"],
    "inboxIds": null,
    "expiresAt": null
  }
}
```

`inboxIds` vaut `null` quand le jeton atteint toutes les boîtes ; sinon, ce sont les boîtes qu’il
atteint réellement, ses choix croisés avec ce que voit son créateur.

:::note[Pour les programmes]
L’API est faite pour un programme, pas pour une page web : seule l’origine de l’inbox y est
admise par CORS. Un jeton dans le code d’une page serait lisible par tous ses visiteurs.
:::

## Le format

- Tout est en **JSON**. Une réponse porte ses données sous `data`.
- Un refus porte un `code` stable et, parfois, des `details`, avec le statut HTTP qui le dit.
- Les dates sont en ISO 8601, en UTC : `2026-10-02T09:14:00.000Z`.
- Les identifiants de conversation, de contact et de conseiller sont des UUID.
- Les textes des messages sont dans le petit Markdown de la Messagerie : `**gras**`,
  `*italique*`, listes, liens, citations.

## Les routes

| Méthode | Route | Droits | Rôle |
|---|---|---|---|
| `GET` | `/me` | lecture | le jeton : nom, droits, accès, boîtes, expiration |
| `GET` | `/conversations` | lecture | lister les conversations |
| `GET` | `/conversations/{id}` | lecture | lire une conversation et tous ses messages |
| `POST` | `/conversations/{id}/messages` | **écriture** | répondre au visiteur, ou écrire une note |
| `POST` | `/conversations/{id}/assign` | **écriture** | affecter à un conseiller, ou remettre dans la file |
| `POST` | `/conversations/{id}/resolve` | **écriture** | résoudre |
| `POST` | `/conversations/{id}/tags` | **écriture** | poser une étiquette |
| `DELETE` | `/conversations/{id}/tags/{label}` | **écriture** | retirer une étiquette |
| `GET` | `/contacts` | lecture | lister ou chercher les contacts |
| `GET` | `/contacts/{id}` | lecture | lire la fiche d’un contact |
| `GET` | `/search` | lecture | chercher dans les messages |
| `GET` | `/inboxes` | lecture | les boîtes de réception du jeton |
| `GET` | `/agents` | lecture | les conseillers actifs |
| `GET` | `/openapi.json` | lecture | la spécification OpenAPI 3.1 |

Toutes les routes sont sous `/api/v1`. Un `{id}` qui n’est pas un UUID reçoit le même refus
qu’un identifiant inconnu : `404`, avec le code de la ressource.

### Lister les conversations

`GET /api/v1/conversations`

Les conversations que le jeton atteint, la plus récente d’abord (par date du dernier message).
**Non résolues** par défaut.

| Paramètre | Type | Rôle |
|---|---|---|
| `status` | texte | `unresolved` (par défaut), `ai` : l’IA répond, `open`, `pending`, `resolved`, `all`. |
| `inbox` | texte | une boîte de réception seulement, par son identifiant (`GET /inboxes`). |
| `assignee` | texte | un conseiller, par son identifiant (`GET /agents`) ; `none` pour la file d’attente. |
| `limit` | entier | 50 par défaut, de 1 à 200. |

```bash
curl "https://chat.exemple.fr/api/v1/conversations?status=open&assignee=none&limit=20" \
  -H "Authorization: Bearer $MESSAGERIE_TOKEN"
```

```json title="200 OK"
{
  "data": [
    {
      "id": "4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90",
      "contact": {
        "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
        "name": "Léa Martin",
        "email": "lea.martin@exemple.fr",
        "identified": true
      },
      "site": "Acme Assurances",
      "siteId": "01a0f647-6c2e-7d41-8b5a-3f9e2c7d1a46",
      "inboxId": "01a0f647-74b7-7450-93a6-8dfe920d8934",
      "teamId": null,
      "status": "open",
      "assignee": null,
      "assigneeId": null,
      "unread": true,
      "handedOff": true,
      "preview": "Où en est le remboursement de mon sinistre ?",
      "previewAuthor": "visitor",
      "previewAgent": null,
      "previewFiles": 0,
      "lastMessageAt": "2026-10-02T09:14:00.000Z",
      "priority": "normal",
      "sentiment": "neutral",
      "tags": [{ "label": "Sinistre", "color": "#f97316", "byAi": true }],
      "snoozedUntil": null
    }
  ]
}
```

| Champ | Sens |
|---|---|
| `contact` | `id`, `name`, `email`, et `identified` : `true` quand le site a signé l’identité (voir [Identité signée](/messagerie/integrations/identite-signee/)). |
| `site`, `siteId` | Le nom du site à l’arrivée de la conversation, et son identifiant. |
| `inboxId`, `teamId` | Sa boîte et son équipe ; `null` si elle n’en a pas. |
| `status` | `ai` : l’IA répond seule · `open` : des conseillers répondent · `pending` : en attente · `resolved` : résolue. |
| `assignee`, `assigneeId` | Le conseiller qui l’a, ou `null` : elle est dans la file. |
| `unread` | Un message du visiteur attend une lecture. |
| `handedOff` | L’IA l’a passée à un conseiller. |
| `preview`, `previewAuthor`, `previewAgent`, `previewFiles` | Le dernier message : son texte, son auteur (`visitor`, `agent`, `ai`), le nom du conseiller s’il vient de lui, son nombre de fichiers. |
| `lastMessageAt` | La date du dernier message. |
| `priority` | `low`, `normal`, `high` ou `urgent`. |
| `sentiment` | `positive`, `neutral`, `negative`, ou `null`. |
| `tags` | Ses étiquettes : `label`, `color`, et `byAi` quand l’IA l’a posée. |
| `snoozedUntil` | Pour une conversation mise en attente, l’heure à laquelle elle revient ; sinon `null`. |

### Lire une conversation

`GET /api/v1/conversations/{id}`

Une conversation entière : les champs de la liste, la fiche complète du contact, le résumé de
l’IA, ses métadonnées et **tous ses messages** — du visiteur, de l’IA, des conseillers, les notes
internes et les événements —, dans l’ordre.

```bash
curl https://chat.exemple.fr/api/v1/conversations/4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90 \
  -H "Authorization: Bearer $MESSAGERIE_TOKEN"
```

```json title="200 OK"
{
  "data": {
    "id": "4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90",
    "contact": {
      "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      "name": "Léa Martin",
      "email": "lea.martin@exemple.fr",
      "phone": null,
      "identified": true,
      "location": null,
      "country": "FR",
      "timeZone": "Europe/Paris",
      "place": { "latitude": 48.8566, "longitude": 2.3522, "approximate": true },
      "segment": "Particulier",
      "attributes": [{ "label": "Contrat", "value": "AUTO-2291", "kind": "code" }],
      "data": {}
    },
    "site": "Acme Assurances",
    "siteId": "01a0f647-6c2e-7d41-8b5a-3f9e2c7d1a46",
    "inboxId": "01a0f647-74b7-7450-93a6-8dfe920d8934",
    "teamId": null,
    "data": { "contrat": "AUTO-2291" },
    "status": "open",
    "snoozedUntil": null,
    "assignee": "Claire Dubois",
    "assigneeId": "0c1d2e3f-4a5b-4c6d-9e8f-7a6b5c4d3e2f",
    "unread": false,
    "intent": "suivi remboursement",
    "tags": [{ "label": "Sinistre", "color": "#f97316", "byAi": true }],
    "sentiment": "neutral",
    "priority": "normal",
    "suggestions": [],
    "summary": "La cliente demande où en est le remboursement de son sinistre du 28 septembre.",
    "history": [
      { "subject": "Attestation d’assurance", "at": "2026-06-11T14:02:00.000Z", "status": "resolved" }
    ],
    "messages": [
      {
        "id": "7d1e0c2a-…",
        "at": "2026-10-02T09:12:00.000Z",
        "kind": "visitor",
        "body": "Où en est le remboursement de mon sinistre ?",
        "attachments": []
      },
      {
        "id": "8e2f1d3b-…",
        "at": "2026-10-02T09:12:04.000Z",
        "kind": "ai",
        "body": "Le remboursement est versé sous 5 à 10 jours ouvrés…",
        "confidence": 0.62,
        "sources": [
          { "title": "Délai de remboursement", "origin": "article", "detail": "…" }
        ],
        "feedback": null
      },
      {
        "id": "9f302e4c-…",
        "at": "2026-10-02T09:14:00.000Z",
        "kind": "agent",
        "author": "Claire Dubois",
        "authorId": "0c1d2e3f-4a5b-4c6d-9e8f-7a6b5c4d3e2f",
        "body": "Votre dossier est **complet** : le virement part demain.",
        "attachments": []
      }
    ]
  }
}
```

En plus des champs de la liste :

| Champ | Sens |
|---|---|
| `contact` | La fiche entière : `phone`, `location`, `country`, `timeZone`, `place` (un point, `approximate` quand il vient du fuseau horaire), `segment`, `attributes` transmis par le site, `data` déclarées par la page ou un conseiller. |
| `data` | Les métadonnées jointes à la conversation par la page ou un conseiller. |
| `intent`, `summary` | L’intention et le résumé qu’en a faits l’IA, ou `null`. |
| `language` | La langue du visiteur (`de`, `en`…), lue par l’IA quand son site traduit ([traduction automatique](/messagerie/fonctionnalites/copilote/#la-traduction-automatique)) ; `null` sinon. |
| `suggestions` | Les réponses que le copilote propose pour la suite, de 0 à 3. |
| `history` | Les autres conversations du contact : `subject`, `at`, `status`. |
| `pages` | Les pages que le visiteur a ouvertes depuis le début de la conversation, la plus récente d’abord, vingt au plus : `url`, `title`, `at`, `leftAt` — `null` tant qu’elle est ouverte. Ce que dit son widget, non vérifié. |
| `messages` | Tous les messages, dans l’ordre — voir ci-dessous. |

Chaque message a un `id`, une date `at` et un `kind` :

| `kind` | Champs | Ce que c’est |
|---|---|---|
| `visitor` | `body`, `attachments` | Ce qu’a écrit le visiteur. `body` est vide s’il n’a envoyé que des fichiers. |
| `agent` | `author`, `authorId`, `body`, `attachments` | Une réponse d’un conseiller — ou d’un jeton. |
| `note` | `author`, `authorId`, `body`, `attachments` | Une note interne, que seule l’équipe voit. |
| `ai` | `body`, `confidence` (0 à 1), `sources`, `feedback` | Une réponse de l’IA, et les passages d’où elle vient. |
| `event` | `event` | Ce qui s’est passé : `{ "type": "assigned", "agent": "Claire Dubois", "by": "Synchronisation CRM" }`, `resolved`, `reopened`, `takeover`, `transferred`, `tool`… |
| `handoff` | `reason`, `summary`, `confidence`, `assignee`, `team` | L’IA a passé la main, avec ce qu’il faut pour reprendre. |

Un fichier joint (`attachments`) porte `id`, `name`, `mime`, `size`, `analysis` (ce qu’en a dit
l’IA, à la demande d’un conseiller, ou `null`) et `url` : un chemin signé, relatif à l’adresse du
serveur, qui lit le fichier sans jeton pendant environ un jour.

Dans une conversation dans une autre langue, un message `visitor` ou `ai` porte `translation` :
`from` (la langue de `body`), `language` (`fr`) et `body`, ses mots en français. Une réponse
`agent` envoyée traduite porte dans `body` ce qu’a lu le visiteur, et dans `translation` les
mots du conseiller.

Un message supprimé pour tout le monde porte `deleted` (`by`, `at`) et un `body` vide.

### Répondre ou noter

`POST /api/v1/conversations/{id}/messages` · **écriture** · réponse `201`

| Champ du corps | Type | Requis | Rôle |
|---|---|---|---|
| `body` | texte | oui | Le texte, en Markdown léger : `**gras**`, `*italique*`, listes, liens. |
| `kind` | texte | non | `reply` (par défaut) : au visiteur. `note` : à l’équipe seule. |
| `resolve` | booléen | non | Résoudre la conversation avec cette réponse. Sans effet sur une note. |

```bash
curl -X POST https://chat.exemple.fr/api/v1/conversations/4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90/messages \
  -H "Authorization: Bearer $MESSAGERIE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "Votre dossier est **complet** : le virement part demain.", "resolve": true}'
```

La réponse est la conversation telle qu’elle est ensuite, comme `GET /conversations/{id}`.

- Une **réponse** part au visiteur, signée du nom du jeton. Elle fait quitter la conversation à
  l’IA ; une conversation résolue est rouverte. Le jeton ne prend pas la conversation : une
  conversation de la file y reste, sans conseiller.
- Une **note** n’est vue que de l’équipe ; elle ne change ni l’état ni le conseiller.
- Un texte vide, ou fait d’espaces, est refusé (`EMPTY_MESSAGE`).

### Affecter

`POST /api/v1/conversations/{id}/assign` · **écriture**

| Champ du corps | Type | Requis | Rôle |
|---|---|---|---|
| `assigneeId` | UUID ou `null` | oui | Un conseiller actif (`GET /agents`), ou `null` pour remettre la conversation dans la file. |

```bash
curl -X POST https://chat.exemple.fr/api/v1/conversations/4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90/assign \
  -H "Authorization: Bearer $MESSAGERIE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assigneeId": "0c1d2e3f-4a5b-4c6d-9e8f-7a6b5c4d3e2f"}'
```

Le conseiller en est averti dans l’inbox. Une conversation que l’IA tenait passe aux
conseillers. Un conseiller inconnu ou inactif est refusé (`AGENT_NOT_FOUND`) ; affecter au
conseiller qui l’a déjà ne change rien. Rend la conversation.

### Résoudre

`POST /api/v1/conversations/{id}/resolve` · **écriture** · sans corps

Marque la conversation comme résolue ; une conversation mise en attente sort de l’attente. Un
nouveau message du visiteur la rouvrira. Résoudre une conversation déjà résolue ne change rien.
Rend la conversation.

### Poser une étiquette

`POST /api/v1/conversations/{id}/tags` · **écriture**

| Champ du corps | Type | Requis | Rôle |
|---|---|---|---|
| `label` | texte | oui | Le nom de l’étiquette, de 1 à 60 caractères. |

```bash
curl -X POST https://chat.exemple.fr/api/v1/conversations/4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90/tags \
  -H "Authorization: Bearer $MESSAGERIE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "Remboursement"}'
```

Une étiquette déclarée dans **Administration › Réponses types et étiquettes**, onglet **Étiquettes**, prend son
nom et sa couleur — la casse ne compte pas. Une autre est posée telle quelle, en gris. Poser une étiquette déjà présente ne change rien. Rend la conversation.

### Retirer une étiquette

`DELETE /api/v1/conversations/{id}/tags/{label}` · **écriture**

`{label}` est le nom de l’étiquette, encodé pour une adresse (`Service%20client`). Retirer une
étiquette absente ne change rien. Rend la conversation.

```bash
curl -X DELETE https://chat.exemple.fr/api/v1/conversations/4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90/tags/Sinistre \
  -H "Authorization: Bearer $MESSAGERIE_TOKEN"
```

### Lister les contacts

`GET /api/v1/contacts`

Les contacts — visiteurs anonymes et clients identifiés par leur site —, le plus récent d’abord,
**200 au plus**. Un jeton limité à des boîtes n’atteint que ceux qui y ont écrit.

| Paramètre | Type | Rôle |
|---|---|---|
| `q` | texte | Un morceau de nom, d’e-mail ou d’identifiant client. |

```json title="200 OK"
{
  "data": [
    {
      "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      "name": "Léa Martin",
      "email": "lea.martin@exemple.fr",
      "identified": true,
      "site": "Acme Assurances",
      "location": null,
      "country": "FR",
      "timeZone": "Europe/Paris",
      "place": { "latitude": 48.8566, "longitude": 2.3522, "approximate": true },
      "conversations": 3,
      "lastMessageAt": "2026-10-02T09:14:00.000Z"
    }
  ]
}
```

`conversations` compte les conversations du contact que le jeton atteint.

### Lire un contact

`GET /api/v1/contacts/{id}`

La fiche d’un contact — ce que son site a transmis, ce que la page ou un conseiller a déclaré —
et ses conversations, la plus récente d’abord.

```json title="200 OK"
{
  "data": {
    "contact": {
      "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      "name": "Léa Martin",
      "email": "lea.martin@exemple.fr",
      "phone": null,
      "identified": true,
      "location": null,
      "country": "FR",
      "timeZone": "Europe/Paris",
      "place": { "latitude": 48.8566, "longitude": 2.3522, "approximate": true },
      "segment": "Particulier",
      "attributes": [{ "label": "Contrat", "value": "AUTO-2291", "kind": "code" }],
      "data": {}
    },
    "site": "Acme Assurances",
    "conversations": [
      {
        "id": "4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90",
        "subject": "suivi remboursement",
        "status": "open",
        "at": "2026-10-02T09:14:00.000Z"
      }
    ]
  }
}
```

Le `subject` d’une conversation est l’intention qu’en a dégagée l’IA, ou à défaut le premier
message du visiteur.

### Chercher dans les messages

`GET /api/v1/search`

Les messages qui contiennent **tous** ces mots, dans n’importe quel ordre, accents et majuscules
à part — réponses et notes internes comprises —, les plus récents d’abord, **20 au plus**.

| Paramètre | Type | Rôle |
|---|---|---|
| `q` | texte, requis | Trois caractères au moins. |

```bash
curl "https://chat.exemple.fr/api/v1/search?q=remboursement%20delai" \
  -H "Authorization: Bearer $MESSAGERIE_TOKEN"
```

```json title="200 OK"
{
  "data": [
    {
      "conversationId": "4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90",
      "messageId": "7d1e0c2a-…",
      "contactName": "Léa Martin",
      "author": "visitor",
      "at": "2026-10-02T09:12:00.000Z",
      "body": "Quel est le délai de remboursement ?"
    }
  ]
}
```

`author` vaut `visitor`, `agent`, `ai` ou `note`.

### Les boîtes de réception

`GET /api/v1/inboxes`

Les boîtes actives que le jeton atteint : ce qu’attend le filtre `inbox` de la liste.

```json title="200 OK"
{
  "data": [
    {
      "id": "01a0f647-74b7-7450-93a6-8dfe920d8934",
      "name": "Service client",
      "description": "Questions générales"
    }
  ]
}
```

### Les conseillers

`GET /api/v1/agents`

Les conseillers actifs, à qui une conversation peut être affectée, avec leurs équipes. Les
jetons n’y figurent pas.

```json title="200 OK"
{
  "data": [
    {
      "id": "0c1d2e3f-4a5b-4c6d-9e8f-7a6b5c4d3e2f",
      "name": "Claire Dubois",
      "email": "claire.dubois@acme.fr",
      "role": "agent",
      "teamIds": ["01a0f647-7a1c-7c2e-9d3f-4b5a6c7d8e9f"]
    }
  ]
}
```

`role` vaut `agent` ou `supervisor`.

## Pagination et limites

L’API n’a **pas de curseur** : une liste rend ses premiers éléments, les plus récents d’abord.
Pour aller plus loin, resserrez la demande — un `status`, une boîte, un conseiller, une
recherche.

| Quoi | Limite |
|---|---|
| Requêtes par jeton | 240 par minute sur l’API REST, autant sur le MCP ; au-delà, `429 RATE_LIMITED`. |
| Conversations par liste | 50 par défaut, 200 au plus (`limit`). |
| Contacts par liste | 200. |
| Résultats d’une recherche | 20, les plus récents. |
| Mots cherchés | 3 caractères au moins. |
| Étiquette | 60 caractères. |

## Refus

Un refus est un objet JSON, avec le statut HTTP qui convient :

```json title="400 Bad Request"
{
  "code": "INVALID_REQUEST",
  "details": { "issues": [{ "field": "status", "message": "Invalid option" }] }
}
```

| Code | Statut | Sens |
|---|---|---|
| `TOKEN_INVALID` | 401 | Pas de jeton, un jeton mal formé ou inconnu, un jeton qui n’ouvre pas l’API REST, ou dont le créateur n’est plus conseiller actif. |
| `TOKEN_EXPIRED` | 401 | Le jeton a dépassé sa date d’expiration. |
| `TOKEN_REVOKED` | 401 | Le jeton a été révoqué. |
| `TOKEN_READ_ONLY` | 403 | Une écriture avec un jeton en lecture seule. |
| `INVALID_REQUEST` | 400 | Un paramètre ou un corps mal formé : `details.issues` dit lequel (`field`) et pourquoi (`message`). |
| `EMPTY_MESSAGE` | 400 | Un message vide. |
| `CONVERSATION_NOT_FOUND` | 404 | Une conversation qui n’existe pas, ou que le jeton n’atteint pas. |
| `CONTACT_NOT_FOUND` | 404 | Un contact qui n’existe pas, ou que le jeton n’atteint pas. |
| `AGENT_NOT_FOUND` | 404 | Un conseiller inconnu, ou qui n’est plus actif. |
| `RATE_LIMITED` | 429 | Plus de 240 requêtes en une minute pour ce jeton. |
| `INTERNAL_ERROR` | 500 | Une erreur du serveur — elle est journalisée de son côté. |

Ces codes sont stables : un programme décide sur le `code`, jamais sur un texte.

## Qui écrit

Un jeton agit sous son propre nom. Ce qu’il écrit est **signé du nom du jeton** dans le fil —
« Synchronisation CRM » — et ses actions s’y lisent comme celles d’un conseiller :
« Synchronisation CRM a confié la conversation à Claire Dubois. »

Ce nom ne figure dans aucune liste de conseillers, ne peut pas recevoir de conversation et ne
reçoit aucune alerte. Une réponse envoyée par un jeton fait quitter la conversation à l’IA, mais
ne la lui affecte pas : elle reste où elle était — dans la file, ou chez son conseiller.

## Un exemple complet

Un script qui note, dans chaque conversation ouverte de la file, le contrat trouvé dans un CRM :

```bash
#!/usr/bin/env bash
API=https://chat.exemple.fr/api/v1
AUTH="Authorization: Bearer $MESSAGERIE_TOKEN"

curl -s "$API/conversations?status=open&assignee=none&limit=200" -H "$AUTH" |
  jq -r '.data[] | select(.contact.identified) | .id' |
  while read -r id; do
    curl -s -X POST "$API/conversations/$id/messages" -H "$AUTH" \
      -H "Content-Type: application/json" \
      -d '{"kind": "note", "body": "Contrat vérifié dans le CRM : **à jour**."}' > /dev/null
  done
```

Le même appel en JavaScript :

```js
const response = await fetch(
  'https://chat.exemple.fr/api/v1/conversations?status=open&limit=20',
  { headers: { Authorization: `Bearer ${process.env.MESSAGERIE_TOKEN}` } },
)
const body = await response.json()
if (!response.ok) throw new Error(body.code)
for (const conversation of body.data) console.log(conversation.contact.name, conversation.preview)
```

## La documentation dans l’inbox

Le bouton **Documentation** de l’écran **API et MCP** ouvre la référence complète, écrite à
partir du code qui tourne : chaque route avec ses paramètres et des exemples en cURL,
JavaScript et Python, les outils du serveur MCP et les webhooks. Les adresses y sont celles de
votre serveur.

La spécification **OpenAPI 3.1** se lit avec un jeton, pour un générateur de client ou un outil
comme Postman :

```bash
curl https://chat.exemple.fr/api/v1/openapi.json \
  -H "Authorization: Bearer $MESSAGERIE_TOKEN"
```
