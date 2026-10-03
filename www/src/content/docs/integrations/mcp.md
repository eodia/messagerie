---
title: Serveur MCP
description: Brancher un agent IA — Claude ou tout client MCP — sur les conversations de la Messagerie.
---

La Messagerie expose un **serveur MCP** (Model Context Protocol) à `/mcp`, sur le serveur du
chat. Un agent — Claude Code, Claude Desktop, un assistant de code, votre propre agent — y lit
les conversations, cherche dans les messages et, si son jeton le permet, répond aux visiteurs,
écrit des notes, affecte, résout et étiquette.

```text
https://chat.exemple.fr/mcp
```

Ses outils passent par le même service que l’[API REST](/messagerie/integrations/api-rest/),
donc par les mêmes fonctions que l’inbox : ce qu’écrit un agent apparaît aussitôt aux
conseillers.

## Un jeton

Créez un jeton dans **Administration › API et MCP**, bouton **Nouveau jeton**, avec **MCP** coché
sous **Accès**. Le même jeton peut aussi ouvrir l’API REST. Ses droits, ses boîtes, sa durée et
sa révocation sont ceux de tout jeton : voir [Un jeton](/messagerie/integrations/api-rest/#un-jeton).

À sa création, la fenêtre **Jeton créé** donne, prêts à copier, la commande pour Claude Code et
la configuration `mcpServers`, avec l’adresse de votre serveur.

:::tip[Lecture seule d’abord]
Pour un agent qui résume, cherche ou prépare des réponses, un jeton en **Lecture seule**
suffit : il ne pourra rien envoyer au visiteur, même par erreur.
:::

## Brancher un agent

### Claude Code

```bash
export MESSAGERIE_TOKEN="msg_k3v9x2ma_…"
claude mcp add --transport http messagerie https://chat.exemple.fr/mcp \
  --header "Authorization: Bearer $MESSAGERIE_TOKEN"
```

Le shell remplace `$MESSAGERIE_TOKEN` par sa valeur : c’est elle que Claude Code enregistre.
Pour ne pas l’écrire dans la configuration, déclarez plutôt le serveur dans le `.mcp.json` du
projet, où Claude Code lit la variable au démarrage :

```json title=".mcp.json"
{
  "mcpServers": {
    "messagerie": {
      "type": "http",
      "url": "https://chat.exemple.fr/mcp",
      "headers": { "Authorization": "Bearer ${MESSAGERIE_TOKEN}" }
    }
  }
}
```

### Un autre client

Tout client qui parle le transport HTTP de MCP se branche avec deux choses : l’adresse
`https://chat.exemple.fr/mcp` et l’en-tête `Authorization: Bearer <jeton>`. La plupart lisent
une configuration de la forme ci-dessus ; la façon d’y citer une variable d’environnement
dépend du client.

Un client qui ne sait lancer que des processus locaux (stdio) passe par un relais, comme
`mcp-remote` :

```json title="mcpServers"
{
  "mcpServers": {
    "messagerie": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://chat.exemple.fr/mcp",
        "--header",
        "Authorization:Bearer ${MESSAGERIE_TOKEN}"
      ],
      "env": { "MESSAGERIE_TOKEN": "msg_…" }
    }
  }
}
```

## Le protocole

- **Transport** : HTTP « Streamable », réponses JSON, jamais de flux. Seul `POST /mcp` répond ;
  `GET` et `DELETE` répondent `405`.
- **Session** : aucune. Chaque requête vérifie le jeton et ses droits ; une révocation vaut dès
  la requête suivante.
- **Page web** : une requête qui porte un en-tête `Origin` est refusée (`403`) — un client MCP
  est un programme, pas une page ouverte dans un navigateur.
- **Serveur** : il se présente comme `messagerie`, version `0.1.0`, avec des instructions pour
  l’agent : commencer par `whoami`, puis `list_conversations` et `get_conversation` ; relire une
  réponse avant `send_reply`, car elle part au visiteur.
- **Limite** : 240 requêtes par minute et par jeton ; au-delà, `429`.

Les outils ont des noms anglais et des descriptions en français. Chacun annonce sa nature : un
outil de lecture est marqué `readOnlyHint`, un outil d’écriture ne l’est pas, et aucun n’est
destructif (`destructiveHint: false`). Chaque outil rend son résultat en JSON, dans un bloc de
texte.

## Les outils

| Outil | Droits | Ce qu’il fait |
|---|---|---|
| `whoami` | lecture | Le jeton utilisé : son nom, ses droits, les boîtes qu’il atteint. |
| `list_inboxes` | lecture | Les boîtes de réception que le jeton atteint. |
| `list_agents` | lecture | Les conseillers actifs, à qui une conversation peut être affectée. |
| `list_conversations` | lecture | Les conversations, les plus récentes d’abord. |
| `get_conversation` | lecture | Une conversation entière, avec tous ses messages. |
| `search_messages` | lecture | Les messages qui contiennent tous ces mots. |
| `list_contacts` | lecture | Les contacts, cherchés par nom, e-mail ou identifiant client. |
| `get_contact` | lecture | Une fiche de contact et ses conversations. |
| `start_conversation` | **écriture** | Écrire le premier à un client, par SMS ou par e-mail. |
| `send_reply` | **écriture** | Répondre au visiteur. |
| `add_note` | **écriture** | Écrire une note interne. |
| `assign_conversation` | **écriture** | Affecter à un conseiller, ou remettre dans la file. |
| `resolve_conversation` | **écriture** | Résoudre. |
| `add_tag` | **écriture** | Poser une étiquette. |
| `remove_tag` | **écriture** | Retirer une étiquette. |

**Un jeton en lecture seule ne voit pas les outils d’écriture** : ils ne figurent pas dans la
liste que reçoit l’agent. Aucun outil ne supprime, et aucun ne prend une autre identité que celle
du jeton.

### Outils de lecture

#### `whoami`

Le jeton utilisé : son nom, ses droits (`read` ou `write`), les boîtes qu’il atteint. Sans
argument. Rend `label`, `prefix`, `access`, `surfaces`, `inboxIds` (`null` : toutes les boîtes
de son créateur) et `expiresAt`.

#### `list_inboxes`

Les boîtes de réception que ce jeton atteint : leur identifiant et leur nom. Sans argument. Rend
`id`, `name`, `description`.

#### `list_agents`

Les conseillers actifs, à qui une conversation peut être affectée. Sans argument. Rend `id`,
`name`, `role` (`agent` ou `supervisor`).

#### `list_conversations`

Les conversations, les plus récentes d’abord : le contact, l’état, le conseiller, les étiquettes
et le dernier message. Non résolues par défaut.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `status` | texte | non | `unresolved` (par défaut), `ai` : l’IA répond, `open`, `pending`, `resolved`, `all`. |
| `inbox_id` | texte | non | Une boîte de réception seulement (`list_inboxes`). |
| `assignee_id` | texte | non | Un conseiller (`list_agents`), ou `none` pour la file d’attente. |
| `limit` | entier | non | 50 par défaut, de 1 à 200. |

Chaque conversation rendue porte `id`, `contact` (son nom), `email`, `status`, `inbox_id`,
`assignee`, `unread`, `priority`, `sentiment`, `tags` (leurs noms), `last_message` (`from` et
`text`, coupé à 240 caractères) et `last_message_at`.

#### `get_conversation`

Une conversation entière : le contact, l’état, le résumé de l’IA, les métadonnées et tous les
messages — du visiteur, de l’IA, des conseillers, les notes internes et les événements.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `conversation_id` | UUID | oui | L’identifiant de la conversation. |

Rend `id`, `status`, `site`, `inbox_id`, `assignee`, `priority`, `sentiment`, `intent`, `tags`,
`summary`, `data`, `contact` (`id`, `name`, `email`, `phone`, `identified`) et `messages`.
Chaque message porte `id`, `at` et `from` :

| `from` | Autres champs |
|---|---|
| `visitor` | `text`, `files` (les noms des fichiers joints) |
| `agent` | `author`, `text`, `files` |
| `note` | `author`, `text` |
| `ai` | `text`, `confidence` (0 à 1) |
| `event` | `event` : ce qui s’est passé, en données (`{ "type": "resolved", "agent": "…" }`) |
| `handoff` | — l’IA a passé la main |

Un message supprimé pour tout le monde ne porte que `id`, `at` et `deleted: true`.

#### `search_messages`

Les messages qui contiennent tous ces mots, accents à part, les plus récents d’abord — 20 au
plus.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `query` | texte | oui | Trois caractères au moins. |

Rend `conversationId`, `messageId`, `contactName`, `author` (`visitor`, `agent`, `ai`, `note`),
`at`, `body`.

#### `list_contacts`

Les contacts — visiteurs et clients —, cherchés par nom, e-mail ou identifiant client ; 200 au
plus.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `query` | texte | non | Tout le monde si absent. |

#### `get_contact`

Une fiche de contact et ses conversations.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `contact_id` | UUID | oui | L’identifiant du contact. |

`list_contacts` et `get_contact` rendent les mêmes objets que
[`GET /contacts`](/messagerie/integrations/api-rest/#lister-les-contacts) et
[`GET /contacts/{id}`](/messagerie/integrations/api-rest/#lire-un-contact).

### Outils d’écriture

Proposés aux jetons en **Lecture et écriture** seulement. Chacun rend la conversation telle
qu’elle est ensuite, sous la forme de `get_conversation`.

:::caution[Une réponse part au visiteur]
`send_reply` envoie le texte au visiteur, dans son widget, signé du nom du jeton. Demandez à
l’agent de vous montrer sa réponse avant de l’envoyer, ou de la poser en note (`add_note`) pour
qu’un conseiller la relise.
:::

#### `start_conversation`

Écrit le premier à un client : par SMS depuis un numéro de la messagerie, ou par e-mail — voir
[Écrire en premier](/messagerie/integrations/api-rest/#écrire-en-premier). La conversation reste
dans la file.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `channel` | texte | oui | `sms` ou `email`. |
| `text` | texte | oui | Le message. |
| `contact_id` | UUID | non | Un contact connu (`list_contacts`). |
| `phone` | texte | non | Pour un SMS : le numéro, `+33612345678`. |
| `email` | texte | non | Pour un e-mail : l’adresse. |
| `name` | texte | non | Le nom d’un nouveau contact. |

#### `send_reply`

Envoie une réponse au visiteur, signée du nom du jeton. Markdown léger accepté (gras, italique,
listes, liens). La conversation quitte l’IA et reste dans la file ; une conversation résolue est
rouverte.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `conversation_id` | UUID | oui | L’identifiant de la conversation. |
| `text` | texte | oui | La réponse. |
| `resolve` | booléen | non | Résoudre la conversation avec cette réponse. |

#### `add_note`

Ajoute une note que seule l’équipe voit — jamais le visiteur.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `conversation_id` | UUID | oui | L’identifiant de la conversation. |
| `text` | texte | oui | La note. |

#### `assign_conversation`

Confie la conversation à un conseiller (`list_agents`), ou la remet dans la file avec `null`. Le
conseiller en est averti dans l’inbox.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `conversation_id` | UUID | oui | L’identifiant de la conversation. |
| `agent_id` | UUID ou `null` | oui | Un conseiller, ou `null` pour la file. |

#### `resolve_conversation`

Marque la conversation comme résolue.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `conversation_id` | UUID | oui | L’identifiant de la conversation. |

#### `add_tag`

Pose une étiquette sur la conversation. Une étiquette déclarée dans **Administration › Réponses
types et étiquettes**, onglet **Étiquettes**, prend sa couleur.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `conversation_id` | UUID | oui | L’identifiant de la conversation. |
| `label` | texte | oui | Le nom de l’étiquette, 60 caractères au plus. |

#### `remove_tag`

Retire une étiquette de la conversation.

| Argument | Type | Requis | Description |
|---|---|---|---|
| `conversation_id` | UUID | oui | L’identifiant de la conversation. |
| `label` | texte | oui | Le nom de l’étiquette. |

Un appel, tel que le client l’envoie :

```json title="tools/call"
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "send_reply",
    "arguments": {
      "conversation_id": "4f1c2e8a-7b3d-4c9e-a1f0-2d5e6b7c8a90",
      "text": "Votre dossier est **complet** : le virement part demain.",
      "resolve": true
    }
  }
}
```

## Refus

**Un outil refusé ne lève pas d’erreur JSON-RPC** : il rend un résultat marqué `isError`, dont
le texte est un objet JSON — un code, et ce qu’il veut dire. L’agent le lit et peut se
reprendre.

```json title="Résultat refusé"
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "{\"code\":\"TOKEN_READ_ONLY\",\"message\":\"Ce jeton ne permet que la lecture.\"}"
    }
  ]
}
```

| Code | Sens |
|---|---|
| `CONVERSATION_NOT_FOUND` | Cette conversation n’existe pas, ou ce jeton ne l’atteint pas. |
| `CONTACT_NOT_FOUND` | Ce contact n’existe pas, ou ce jeton ne l’atteint pas. |
| `AGENT_NOT_FOUND` | Ce conseiller n’existe pas ou n’est plus actif : voyez `list_agents`. |
| `TOKEN_READ_ONLY` | Ce jeton ne permet que la lecture. |
| `EMPTY_MESSAGE` | Le message est vide. |
| `INVALID_REQUEST` | La demande est mal formée. |
| `RATE_LIMITED` | Trop de demandes : réessayez dans une minute. |

**Une requête refusée avant tout outil** reçoit une erreur JSON-RPC `-32000`, son code en
message, avec le statut HTTP qui le dit :

| Code | Statut | Cause |
|---|---|---|
| `TOKEN_INVALID` | 401 | Pas de jeton, un jeton mal formé ou inconnu, un jeton qui n’ouvre pas le MCP, ou dont le créateur n’est plus conseiller actif. |
| `TOKEN_EXPIRED` | 401 | Le jeton a expiré. |
| `TOKEN_REVOKED` | 401 | Le jeton a été révoqué. |
| `ORIGIN_REFUSED` | 403 | La requête porte un en-tête `Origin` : elle vient d’une page web. |
| `METHOD_NOT_ALLOWED` | 405 | Un `GET` ou un `DELETE` : il n’y a ni session ni flux à ouvrir ou fermer. |
| `RATE_LIMITED` | 429 | Plus de 240 requêtes en une minute pour ce jeton. |

```json title="401 Unauthorized"
{ "jsonrpc": "2.0", "error": { "code": -32000, "message": "TOKEN_REVOKED" }, "id": null }
```

## Ce qu’on demande à un agent

Une fois le serveur branché, on parle à l’agent comme à un collègue ; il choisit les outils.

- « Quelles conversations attendent dans la file depuis ce matin ? Résume-les en une ligne
  chacune. »
- « Retrouve les messages qui parlent de “délai de remboursement” cette semaine, et dis-moi ce
  qui revient le plus. »
- « Lis la conversation avec Léa Martin et propose une réponse — ne l’envoie pas. »
- « Ajoute une note interne à cette conversation : contrat vérifié, dossier complet. »
- « Étiquette “Sinistre” toutes les conversations ouvertes qui parlent d’un accident, puis
  confie-les à Claire Dubois. »

L’agent n’a jamais plus de droits que son jeton : ni les boîtes qu’il n’atteint pas, ni les
outils d’écriture avec un jeton en lecture seule. Ce qu’il écrit est signé du nom du jeton dans
le fil, et se lit comme l’action d’un conseiller.
