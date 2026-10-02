---
title: Outils de l’IA
description: Les seules actions de l’IA — lire la fiche du client, appeler une API, noter un rappel, utiliser les outils d’un serveur MCP — déclarées dans le paramétrage, secrets lus dans l’environnement, et chaque appel tracé dans le fil.
---

L’IA n’agit que par les outils qu’on lui déclare : une ligne de la table « Outils IA », ou un
outil d’un serveur de la table « Serveurs MCP ». Un outil qui n’y est pas n’existe pas pour
elle (D9). Chaque appel laisse un événement dans le fil de la conversation, que les conseillers
voient et le visiteur non.

Un outil sert à deux publics, chacun par sa case :

- **L’agent IA** (« Agent IA ») : l’IA qui répond aux visiteurs peut l’appeler seule, en trois
  tours au plus avant de répondre ([agent IA](/messagerie/fonctionnalites/agent-ia/)) ;
- **Le copilote** (« Copilote ») : il est proposé aux conseillers, dans la section **Outils IA**
  du panneau de la conversation, qui le lancent pour le client ([copilote](/messagerie/fonctionnalites/copilote/#les-outils-depuis-le-panneau)).

## L’écran « Outils IA »

Les outils se règlent dans **Administration › Outils IA** (`/outils`), en deux onglets :
**Outils** et **Serveurs MCP**. L’écran est bâti comme les autres écrans de paramétrage
([paramétrage](/messagerie/fonctionnalites/parametrage/#le-kit-studio)) : la liste à gauche,
le formulaire au milieu, et à droite **l’outil tel que l’IA le lit et la requête qu’il
envoie**, dessinés en direct :

- **Ce que l’IA voit** : le nom de l’outil, sa description, ses paramètres — leur type, la
  mention **obligatoire**, ce que l’IA doit y mettre. Sans description, l’écran prévient : « Sans
  description, l’IA ne saura pas quand l’appeler. »
- **La requête envoyée**, pour un appel HTTP : la méthode, l’adresse, l’en-tête
  `Authorization`, les autres en-têtes et le corps. Ce que l’IA donne est en violet (**donné par
  l’IA**), ce qui vient de l’environnement porte un cadenas (**lu dans l’environnement du
  serveur**).

**Essayer**, en tête de l’aperçu, lance l’outil avec des paramètres saisis à la main, et
affiche sa **Réponse** : « Un essai : hors de toute conversation, sans client et sans trace dans
un fil. » Il faut d’abord enregistrer l’outil, actif. L’essai est réservé aux superviseurs.

## Les trois genres d’outils

**Ce qu’il fait** choisit le genre (champ « Type ») :

| À l’écran | Type | Ce que fait l’outil |
|---|---|---|
| **Appel HTTP** | « Appel HTTP » | appelle une API, la vôtre ou une autre |
| **Fiche du visiteur** | « Fiche du visiteur » | lit ce que le site a transmis du client connecté |
| **Rappel** | « Rappel » | note qu’un conseiller doit rappeler le client |

Un nouvel outil est un **Appel HTTP**, en GET, offert à l’agent IA et au copilote.

Pour tous : un **Nom** (« Nom »), et **Pour l’IA** (« Description pour l'IA ») — ce que fait
l’outil et quand l’appeler : c’est tout ce que le modèle en sait.

### Les paramètres

**Paramètres** dit ce que l’IA doit fournir en appelant l’outil. Chacun a un nom, un type
(**Texte**, **Nombre**, **Entier**, **Oui / non**), une description — **Ce que l’IA doit y
mettre** — et la case **Obligatoire**. **Ajouter un paramètre** en ajoute un ; sans paramètre,
l’IA l’appelle sans rien lui donner. Le bouton **JSON** montre le schéma JSON lui-même, qui est
ce que garde le champ « Paramètres ».

### Appel HTTP

| Champ | À l’écran | Rôle |
|---|---|---|
| « Cible » | **Adresse** | l’adresse appelée ; `{paramètre}` y est remplacé par la valeur que donne l’IA |
| « Méthode » | **GET** ou **POST** | GET ne met les paramètres que dans l’adresse ; POST les envoie aussi en JSON |
| « Jeton (variable d'environnement) » | **Jeton (Authorization: Bearer)** | le **nom** d’une variable d’environnement du serveur, dont la valeur part en `Authorization: Bearer` |
| « En-têtes » | **En-têtes** | un en-tête par ligne, « Nom: valeur » ; `${NOM}` y est remplacé par la variable d’environnement `NOM` |

```text
GET https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current=temperature_2m
User-Agent: Messagerie-Acme/1.0
X-Api-Key: ${METEO_CLE}
```

En POST, le corps porte les paramètres et le client de la conversation :

```json
{
  "parameters": { "numero": "SIN-2026-0412" },
  "contact": { "externalId": "c-1043", "name": "Sophie Bernard", "email": "sophie@exemple.fr" }
}
```

L’appel attend la réponse huit secondes au plus ; l’IA en lit les 4 000 premiers caractères.
Une réponse en erreur lui est dite comme telle (« Erreur 404. »).

### Fiche du visiteur

L’outil donne à l’IA ce que le site a transmis du client connecté, ligne par ligne
([identité signée](/messagerie/integrations/identite-signee/)). Il n’a besoin d’aucun paramètre,
et n’a pas de cible : il ne lit que la fiche du client de la conversation. Pour un visiteur
anonyme, il répond qu’il n’y a pas de fiche ; pour un client dont le site n’a rien transmis,
qu’il n’y a aucune information.

L’IA reçoit déjà la fiche du client avec chaque message
([agent IA](/messagerie/fonctionnalites/agent-ia/#comment-elle-répond)) ; l’outil la met aussi
à portée du conseiller, depuis le panneau, et chaque lecture laisse un événement dans le fil.

### Rappel

L’outil prend deux paramètres, `telephone` et `creneau`. Il ne planifie rien ailleurs : il dit
au client qu’un conseiller rappellera, laisse dans le fil « rappel au 06 12 34 56 78 — demain
matin », et pose sur la conversation l’étiquette « À rappeler » si elle existe dans la table
« Étiquettes ».

## Aucun secret dans le paramétrage

Tout superviseur qui ouvre l’écran lirait un secret qui y serait écrit. Un outil ou un serveur
MCP y **nomme** donc la variable d’environnement qui porte son jeton, jamais sa valeur (D5) :

- **Jeton (Authorization: Bearer)** prend le nom d’une variable : `METEO_TOKEN` ;
- dans **En-têtes**, `${NOM}` est remplacé, à l’appel, par la variable `NOM` du serveur de la
  messagerie : `X-Api-Key: ${METEO_CLE}`.

Un en-tête dont la variable n’existe pas n’est pas envoyé, plutôt qu’envoyé vide. Les en-têtes
`Host`, `Content-Length` et `Connection` ne se règlent pas. Une valeur d’en-tête qui ressemble
à un secret écrit en clair fait prévenir l’écran : « Cela ressemble à un secret écrit en clair :
il serait lisible par tous les superviseurs. Écrivez ${NOM} et mettez la valeur dans
l’environnement du serveur. »

## Les serveurs MCP

Un serveur [MCP](https://modelcontextprotocol.io) offre ses outils à l’IA — un service interne,
une API métier, une base documentaire — sans une ligne de code dans la messagerie. Elle en est
le client, en HTTP « Streamable ».

| Champ | À l’écran | Rôle |
|---|---|---|
| « Nom » | **Nom** | précède le nom de chaque outil dans le fil : « Agences Acme (démo) › trouver_agence » |
| « Adresse » | **Adresse** | le point d’entrée MCP en HTTP : `https://outils.exemple.fr/mcp` |
| « Description » | **Ce que l’IA y trouve** | l’IA le lit pour choisir ses outils |
| « Jeton (variable d'environnement) » | **Jeton (Authorization: Bearer)** | le nom d’une variable d’environnement, comme pour un outil |
| « En-têtes » | **En-têtes** | « Nom: valeur », `${NOM}` remplacé |
| « Outils autorisés » | **Outils offerts** | les outils du serveur offerts à l’IA ; aucun coché : tous |
| « Agent IA », « Copilote » | **Qui s’en sert** | comme pour un outil |

L’aperçu montre la **Connexion** — « 2 outils offerts », ou **Ne répond pas** — et **Ses outils,
tels que l’IA les voit**, chacun avec son bouton **Essayer**. Dans la liste, un point vert ou
rouge dit si chaque serveur répond ; **Vérifier**, en tête de l’écran, les interroge de
nouveau.

La messagerie ouvre une connexion par serveur à la première utilisation, relit la liste de ses
outils toutes les cinq minutes, et attend un appel quinze secondes au plus. Un serveur qui ne
répond pas coûte ses outils, jamais la conversation : l’IA répond sans eux.

:::note[Deux MCP différents]
Cette page parle des serveurs MCP **que l’IA appelle**. La messagerie est aussi elle-même un
serveur MCP, que d’autres agents appellent : voir [Serveur MCP](/messagerie/integrations/mcp/).
:::

### Le serveur de démonstration « Agences Acme »

Le dépôt contient un petit serveur MCP de démonstration : les agences d’Acme Assurances, avec
deux outils, `trouver_agence` (l’agence la plus proche d’une ville) et `horaires_agence`. Il
écoute sur le port 8820 :

```bash
pnpm --filter @chat/server mcp-demo
```

La démonstration, que le serveur écrit au premier démarrage en développement, le déclare à
l’IA (« Agences Acme (démo) », `http://localhost:8820/mcp`, pour l’agent IA et le copilote),
avec trois outils à elle : « Consulter la fiche du client » (fiche du visiteur), « Créer un
rappel » et « Météo » (appel HTTP). Un visiteur qui demande « Où est votre agence à Lyon ? » voit
l’IA l’appeler, et le conseiller lit dans le fil : « L’IA a utilisé l’outil « Agences Acme
(démo) › trouver_agence » : ville : Lyon. »

## Dans le fil

Chaque appel d’outil — par l’IA ou lancé par un conseiller depuis le panneau — laisse un
événement dans le fil, avec la clé à molette :

> L’IA a utilisé l’outil « Météo » : latitude : 45.76, longitude : 4.84 — api.open-meteo.com 200.

Il dit l’outil, les paramètres donnés et l’issue : le domaine appelé et son code HTTP, la fiche
lue (« fiche du client c-1043 », ou « visiteur anonyme »), « échec » quand un serveur MCP a
répondu par une erreur. Le
visiteur ne le voit pas.

Ce qu’un outil renvoie est masqué avant d’aller à un modèle externe, comme le reste de la
conversation ; les paramètres que l’IA donne retrouvent leurs vraies valeurs avant l’appel
([données personnelles](/messagerie/fonctionnalites/agent-ia/#les-données-personnelles)).
