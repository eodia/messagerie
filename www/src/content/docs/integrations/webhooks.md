---
title: Webhooks
description: Prévenir un autre système, dans les secondes, de ce qui se passe dans les conversations.
---

Un webhook fait l’inverse de l’[API REST](/messagerie/integrations/api-rest/) : c’est la
Messagerie qui appelle un autre système — un CRM, un entrepôt de données, une alerte — quand
quelque chose se passe dans les conversations. Un message arrive, l’IA passe la main, une
conversation est résolue : quelques secondes plus tard, l’adresse du webhook reçoit un `POST`
signé qui le dit.

Les événements sont captés **dans la transaction qui fait la chose**, par des déclencheurs de
PostgreSQL : rien ne se perd entre une écriture et son annonce, qu’elle vienne de l’inbox, de
l’IA, du widget ou de l’API.

## Créer un webhook

Dans **Administration › API et MCP**, onglet **Webhooks**, bouton **Nouveau webhook**. Seuls les
superviseurs gèrent les webhooks.

| Champ | Ce qu’il règle |
|---|---|
| **Nom** | Pour le reconnaître dans la liste, 200 caractères au plus. |
| **Adresse (HTTPS)** | Où envoyer : une adresse HTTPS publique (voir [Les adresses permises](#les-adresses-permises)). |
| **Quand prévenir** | Les événements qui l’appellent, en deux groupes : **Messages** et **Conversations**. Un au moins. |
| **Boîtes de réception** | **Toutes**, ou **Certaines** : il n’entend alors que les conversations de ces boîtes. |

**Créer le webhook** vérifie l’adresse, puis ouvre la fenêtre **Webhook créé** : elle montre le
**secret de signature**, le code qui vérifie un envoi et un exemple de ce qui arrive.

:::caution[Le secret ne s’affiche qu’une fois]
Copiez-le avant **J’ai copié le secret** et gardez-le du côté du système destinataire : il sert
à vérifier que chaque envoi vient bien de votre Messagerie. Il commence par `whsec_`. Perdu, il
ne se retrouve pas : recréez le webhook.
:::

## Les événements

| Type | Dans l’écran | Quand | Porte |
|---|---|---|---|
| `message.created` | **Nouveau message** | Un message du visiteur, de l’IA ou d’un conseiller, ou une note interne. | `conversation`, `message` |
| `message.deleted` | **Message supprimé** | Un message supprimé pour tout le monde. | `conversation`, `message` |
| `message.undelivered` | **Message non remis** | Une réponse n’a pas atteint le client : un SMS ou un e-mail refusé, ou perdu après ses essais. `message.delivery.error` dit pourquoi (`TWILIO_21610`, `SMTP_550`…). | `conversation`, `message` |
| `conversation.created` | **Nouvelle conversation** | Une conversation commence. | `conversation` |
| `conversation.handed_off` | **Passée à un conseiller** | L’IA passe la main à un conseiller. | `conversation`, `message` |
| `conversation.assigned` | **Affectée** | Le conseiller de la conversation change : une affectation, une reprise, un retour dans la file. | `conversation` |
| `conversation.transferred` | **Transférée** | La conversation change de boîte ou d’équipe. | `conversation` |
| `conversation.resolved` | **Résolue** | La conversation est résolue. | `conversation` |
| `conversation.reopened` | **Rouverte** | Une conversation résolue reprend. | `conversation` |
| `webhook.ping` | **Test** | Un test envoyé depuis l’écran. | `webhook` |

:::note[Les notes internes]
`message.created` annonce aussi les notes internes, avec `"kind": "note"` : filtrez-les si le
système destinataire est vu des clients.
:::

Une conversation transférée est annoncée aux webhooks qui écoutent sa **nouvelle** boîte.

## Ce qui arrive

Un `POST` en JSON, qui porte de **1 à 50 événements**, les plus anciens en premier :

```http title="Requête"
POST /messagerie HTTP/1.1
Content-Type: application/json
User-Agent: messagerie-webhook/1
X-Messagerie-Signature: t=1790932443,v1=5f2b9c…
X-Messagerie-Delivery-Id: 1d5e7a90-…
X-Messagerie-Webhook-Id: 7c0a3f12-…
```

```json title="Corps"
{
  "events": [
    {
      "id": "6f1c2e8a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      "type": "message.created",
      "occurredAt": "2026-10-02T09:14:03.512Z",
      "conversation": {
        "id": "4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90",
        "contact": {
          "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
          "name": "Léa Martin",
          "email": "lea.martin@exemple.fr",
          "identified": true
        },
        "site": "Acme Assurances",
        "siteId": "01a0f647-6c2e-7d41-8b5a-3f9e2c7d1a46",
        "channel": "web",
        "inboxId": "01a0f647-74b7-7450-93a6-8dfe920d8934",
        "teamId": null,
        "status": "open",
        "assignee": "Claire Dubois",
        "assigneeId": "0c1d2e3f-4a5b-4c6d-9e8f-7a6b5c4d3e2f",
        "unread": true,
        "handedOff": true,
        "preview": "Où en est mon remboursement ?",
        "previewAuthor": "visitor",
        "previewAgent": null,
        "previewFiles": 0,
        "lastMessageAt": "2026-10-02T09:14:03.510Z",
        "priority": "normal",
        "sentiment": "neutral",
        "tags": [{ "label": "Sinistre", "color": "#f97316", "byAi": true }],
        "snoozedUntil": null
      },
      "message": {
        "id": "9a8b7c6d-1e2f-4a3b-9c4d-5e6f7a8b9c0d",
        "at": "2026-10-02T09:14:03.510Z",
        "kind": "visitor",
        "body": "Où en est mon remboursement ?",
        "attachments": []
      }
    }
  ]
}
```

Chaque événement porte :

| Champ | Sens |
|---|---|
| `id` | L’identifiant de l’événement : **la clé pour dédoublonner**. |
| `type` | Son type, du tableau ci-dessus. |
| `occurredAt` | Quand c’est arrivé, en ISO 8601 et en UTC. |
| `conversation` | La conversation telle que la liste la donne — le même objet que [`GET /api/v1/conversations`](/messagerie/integrations/api-rest/#lister-les-conversations). |
| `message` | Pour les événements de message et `conversation.handed_off` : le message, de la même forme que dans [une conversation](/messagerie/integrations/api-rest/#lire-une-conversation) (`kind` : `visitor`, `agent`, `ai`, `note` ou `handoff`). |
| `webhook` | Pour `webhook.ping` seulement : `id` et `label` du webhook testé. |

:::note[L’état au moment de l’envoi]
`conversation` et `message` disent leur état **au moment de l’envoi**, pas à celui de
l’événement : une conversation résolue entre-temps arrive avec `"status": "resolved"`, même
dans un `message.created`. Un message supprimé arrive sans texte ni fichiers, avec `deleted`
(`by`, `at`).
:::

Le `url` d’un fichier joint est un chemin signé, relatif à l’adresse du serveur du chat, qui
lit le fichier sans jeton pendant environ un jour.

Un test ressemble à ceci :

```json title="webhook.ping"
{
  "events": [
    {
      "id": "2b7e4c1a-…",
      "type": "webhook.ping",
      "occurredAt": "2026-10-02T09:20:11.204Z",
      "webhook": { "id": "7c0a3f12-…", "label": "Synchronisation CRM" }
    }
  ]
}
```

### Les en-têtes

| En-tête | Ce qu’il porte |
|---|---|
| `X-Messagerie-Signature` | `t=<secondes>,v1=<hex>` : l’heure de l’envoi, et le HMAC-SHA256, avec le secret, de `<t>.<corps brut>`. |
| `X-Messagerie-Delivery-Id` | L’identifiant de cet appel — un nouvel essai en a un autre. |
| `X-Messagerie-Webhook-Id` | Le webhook qui appelle. |
| `User-Agent` | `messagerie-webhook/1`. |

## Vérifier la signature

Recalculez le HMAC-SHA256 de `<t>.<corps brut>` avec le secret **entier**, `whsec_` compris,
comparez-le en temps constant, et refusez un `t` de plus de cinq minutes : un envoi rejoué plus
tard ne passe pas. Calculez-le sur le **corps brut** reçu, avant tout décodage JSON : un corps
décodé puis réécrit ne donne plus les mêmes octets.

```js title="Node.js (Express)"
import { createHmac, timingSafeEqual } from 'node:crypto'
import express from 'express'

function authentique(header, body, secret) {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.split('=', 2)))
  const t = Number(parts.t)
  if (!Number.isInteger(t) || typeof parts.v1 !== 'string') return false
  if (Math.abs(Date.now() / 1000 - t) > 300) return false
  const attendu = createHmac('sha256', secret).update(`${parts.t}.${body}`).digest()
  const recu = Buffer.from(parts.v1, 'hex')
  return recu.length === attendu.length && timingSafeEqual(recu, attendu)
}

const app = express()
// Le corps brut, en Buffer : surtout pas express.json() sur cette route.
app.post('/messagerie', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.get('X-Messagerie-Signature')
  if (!authentique(signature, req.body, process.env.MESSAGERIE_WEBHOOK_SECRET)) {
    return res.sendStatus(401)
  }
  res.sendStatus(204) // Répondre d’abord, traiter ensuite.
  const { events } = JSON.parse(req.body)
  for (const event of events) traiter(event) // Dédoublonnez par event.id.
})
```

```python title="Python (Flask)"
import hashlib, hmac, json, os, time
from flask import Flask, request

def authentique(header: str | None, body: bytes, secret: str) -> bool:
    try:
        parts = dict(p.split("=", 1) for p in (header or "").split(","))
        t, v1 = parts["t"], parts["v1"]
        if abs(time.time() - int(t)) > 300:
            return False
    except (KeyError, ValueError):
        return False
    attendu = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(v1, attendu)

app = Flask(__name__)

@app.post("/messagerie")
def messagerie():
    body = request.get_data()  # le corps brut, avant tout décodage
    if not authentique(request.headers.get("X-Messagerie-Signature"), body,
                       os.environ["MESSAGERIE_WEBHOOK_SECRET"]):
        return "", 401
    for event in json.loads(body)["events"]:
        traiter(event)  # dédoublonnez par event["id"]
    return "", 204
```

:::tip[Essayer avant le premier message]
Le bouton **Envoyer un test** d’un webhook actif lui envoie un événement `webhook.ping` au
passage suivant, dans les deux secondes : de quoi vérifier la signature et la réponse. Le
journal s’ouvre pour en montrer le résultat.
:::

## La réponse attendue

| Réponse | Ce qui se passe |
|---|---|
| `2xx` en moins de 10 secondes | Livré. |
| `5xx`, `408`, `429`, pas de réponse en 10 secondes, adresse injoignable | Retenté plus tard. |
| Toute autre réponse — `4xx`, une redirection comprise | En échec, sans nouvel essai. |

Les nouveaux essais suivent ce calendrier, à ±20 % près : **10 s, 30 s, 2 min, 10 min, 1 h,
6 h, 1 jour**. Un en-tête `Retry-After` plus long — en secondes ou en date HTTP — est respecté.
Après le **8ᵉ essai**, un peu plus d’un jour après le premier, l’envoi est en échec.

Les redirections ne sont jamais suivies : une adresse qui en renvoie une est en échec.

:::caution[Répondez vite, traitez ensuite]
Au-delà de 10 secondes, l’appel compte comme sans réponse et sera refait. Répondez `2xx` dès la
signature vérifiée, puis traitez les événements à part.
:::

## Ordre et doublons

- Les événements d’une **même conversation** arrivent dans l’ordre où ils se sont produits :
  tant que l’un attend un nouvel essai, les suivants l’attendent aussi. Entre conversations,
  aucun ordre n’est promis.
- Un événement peut arriver **deux fois** — un appel coupé après réception, un serveur arrêté
  au milieu d’un envoi et repris deux minutes plus tard —, jamais se perdre : **dédoublonnez
  par son `id`**. `X-Messagerie-Delivery-Id` change à chaque appel : il ne sert pas à
  dédoublonner.

## Arrêter, reprendre, supprimer

Chaque webhook de la liste montre son nom, son état — **Actif**, **Arrêté**, ou **Arrêté après
des échecs répétés** —, son adresse, ses événements et ses boîtes, et la date du dernier envoi
livré. Ses boutons :

- **Envoyer un test** — sur un webhook actif seulement.
- **Arrêter** : il n’est plus appelé. Pendant l’arrêt, il n’est prévenu de rien : ce qui se
  passe alors ne lui sera jamais envoyé.
- **Reprendre** : son adresse est vérifiée de nouveau, puis ce qui attendait au moment de
  l’arrêt repart, dans l’ordre.
- **Supprimer** : il disparaît de la liste, et ce qui attendait d’être envoyé ne le sera pas.
  Cela ne se défait pas.

**L’arrêt automatique.** Chaque événement envoyé à un webhook est un **envoi**. Quand les **50
derniers envois** d’un webhook ont tous échoué, il s’arrête de lui-même et passe à **Arrêté
après des échecs répétés**. Il se reprend depuis l’écran, une fois le système destinataire
réparé.

### Le journal des envois

**Derniers envois**, sous chaque webhook, montre ses 20 derniers envois, le plus récent
d’abord : l’état (**En attente**, **En cours**, **Livrée**, **Échec**, **Abandonnée**), le type
d’événement, l’heure, le code HTTP reçu ou la raison d’un échec, le nombre de tentatives et
l’heure du prochain essai.

| Raison affichée | Ce qu’elle veut dire |
|---|---|
| **pas de réponse en 10 secondes** | Le délai est dépassé ; l’envoi sera retenté. |
| **injoignable** | La connexion a échoué ; l’envoi sera retenté. |
| **adresse refusée** | Le nom ne donne plus d’adresse, ou plus une adresse permise ; pas de nouvel essai. |
| **redirection refusée** | L’adresse a répondu par une redirection ; pas de nouvel essai. |
| **secret illisible : recréez le webhook** | `CHAT_SECRET` a changé ; voir ci-dessous. |

Le journal ne dit rien de plus du réseau : ni adresse, ni message d’erreur.

**Rétention.** Les envois terminés sont gardés 90 jours ; les événements, 7 jours, plus
longtemps tant qu’un envoi les nomme.

## Les adresses permises

Un webhook ne peut pas devenir une porte vers le réseau où tourne la Messagerie. Son adresse
doit :

- être en **HTTPS**, sur le port **443** ;
- ne porter ni nom d’utilisateur ni mot de passe ;
- mener à une **adresse publique** : toutes les adresses que donne le nom sont vérifiées — une
  seule privée, de bouclage, locale au lien, partagée (`100.64.0.0/10`), de documentation ou de
  multidiffusion suffit à la refuser, une IPv4 cachée dans une IPv6 comprise.

La vérification a lieu à la création, à la reprise et **avant chaque appel**. Refusée à la
création ou à la reprise, l’écran dit seulement « Cette adresse est refusée : HTTPS, vers une
adresse publique. » ; refusée avant un appel, l’envoi est en échec, **adresse refusée**.

Deux variables de l’environnement du serveur assouplissent la règle (voir
[Variables d’environnement](/messagerie/hebergement/variables/)) :

| Variable | Effet |
|---|---|
| `CHAT_WEBHOOK_ALLOW` | Des noms, des domaines (`*.interne.exemple`, pour leurs sous-domaines) ou des plages CIDR, séparés par des virgules, auxquels la Messagerie fait confiance même s’ils sont privés — un CRM interne. HTTPS et le port 443 restent exigés. |
| `CHAT_WEBHOOK_DEV` | `1` : HTTP et HTTPS, sur tout port, vers toute adresse, sans vérification. **En développement seulement**, pour essayer un webhook sur sa machine. |

```bash
CHAT_WEBHOOK_ALLOW=crm.interne.exemple,10.20.0.0/16
```

## Le secret et `CHAT_SECRET`

Le secret de signature sert à chaque appel : il ne peut donc pas être seulement haché, comme
un jeton. Il est **scellé** — chiffré en AES-256-GCM, avec une clé tirée de `CHAT_SECRET` pour
ce seul usage — et ne s’affiche qu’une fois.

:::caution[Changer `CHAT_SECRET`]
Une nouvelle valeur de `CHAT_SECRET` rend illisibles les secrets des webhooks existants : leurs
envois échouent, **secret illisible : recréez le webhook**. Recréez-les, et donnez les nouveaux
secrets aux systèmes destinataires.
:::

:::note[Qui envoie]
Les webhooks partent du serveur du chat, toutes les deux secondes. Avec `CHAT_WORKER=separate`,
ils partent du worker (`pnpm worker`) : sans worker en marche, rien ne part — les événements
attendent.
:::
