# Messagerie

> Nom de travail. Voir [`apps/web/src/lib/product.ts`](apps/web/src/lib/product.ts).

**La messagerie client libre, avec un agent IA en première ligne et un copilote pour les
conseillers. Un serveur, un PostgreSQL : tout le reste se règle dans l'inbox.**

- **Le widget** : un script à coller dans votre site. L'agent IA répond à partir de votre
  base de connaissance, peut appeler des outils (une API, un serveur MCP, la fiche du
  visiteur) et passe la main à un conseiller, avec un résumé, dès qu'il n'est pas sûr de lui.
- **L'inbox** : les boîtes de réception, les conversations, le fil, et ce que le copilote
  propose. Une conversation se transfère d'une boîte ou d'une équipe à l'autre. L'avis du
  conseiller sur chaque réponse de l'IA (acceptée, modifiée, rejetée) nourrit le jeu
  d'évaluation.
- **L'administration, dans l'inbox** : boîtes, équipes, conseillers, sites, horaires,
  réponses types, garde-fous, outils de l'IA, serveurs MCP, articles et widget, dans les
  tables du schéma `chat` (D19). Les conseillers se connectent par mot de passe ou par le
  fournisseur d'identité de l'entreprise (OpenID Connect).

Les décisions qui expliquent le reste sont dans
[`docs/architecture/00-decisions-structurantes.md`](docs/architecture/00-decisions-structurantes.md).

## État

| Partie | État |
|---|---|
| Paramétrage | 14 tables du schéma `chat`, avec les lignes de démonstration d'Acme Assurances, écrites au premier démarrage (D19) |
| Comptes | Mot de passe (scrypt), session en cookie `httpOnly`, invitations par lien, OpenID Connect (D4, D19) |
| Serveur (`apps/server`) | API de l'inbox et du widget, temps réel par WebSocket et `LISTEN/NOTIFY`, schéma `chat` en Drizzle, tâches pg-boss, tests d'intégration |
| Inbox (`apps/web`) | Boîtes de réception, conversations, transferts, métadonnées, contacts, base de connaissance rédigée sur place (éditeur, publication pour l’IA), pièces jointes lues par l’IA sur demande, réponse enrichie (gras, italique, listes, liens) relue par l’IA pendant la frappe, emoji cherchés en français et GIF GIPHY, mode audio (lecture à voix haute par la voix de Mistral, dictée du navigateur), suppression d’un message pour soi ou pour tout le monde (clic droit), palette Ctrl+K (conversations, contacts, mots des messages, commandes), recherche de la liste au même moteur (`/`, `#étiquette`, `@conseiller`), filtres par étiquette, conseiller, priorité, attente ; tableaux de bord ; paramétrage complet ; volets redimensionnables |
| Widget (`apps/widget`) | Preact dans un Shadow DOM, ~60 Ko ; visiteur anonyme ou client connecté (identité signée par le site) ; apparence réglée par site ; API JavaScript `window.MessagerieChat` ; pièces jointes et emoji |
| IA (`packages/ai`) | Mistral par défaut (tout serveur compatible OpenAI) ; réponses sourcées, seuil de confiance, garde-fous, transfert avec résumé, données personnelles masquées |
| Outils de l'IA | Fiche du visiteur, appels HTTP (en-têtes et jetons lus dans l'environnement), rappels, serveurs MCP |
| Alertes | Son, notifications du bureau, pastilles de l'onglet, cloche par conseiller, réglables |
| API et MCP | API REST `/api/v1` et serveur MCP `/mcp` pour les programmes et les agents, avec des jetons (`msg_…`, lecture ou écriture, par boîte), gérés dans « Administration › API et MCP » (D16) |
| Webhooks | Un autre système prévenu de ce qui se passe dans les conversations : appels signés, retentés, dans l'ordre par conversation, gérés dans « Administration › API et MCP » (D17) |
| Automatisations | Un déclencheur (message, transfert, délai sans réponse, heure fixe, bouton, appel d'un autre système), des conditions et des étapes — attribuer, étiqueter, répondre, prévenir, appeler une adresse, demander à l'IA, attendre —, sur un flux comme celui de basedb, avec ses modèles et le journal de ses exécutions (D20) |
| Actions de la page | La page déclare ce qu'elle sait faire (`registerAction`) et où elle en est (`setPageContext`) ; l'IA tarifie, remplit un formulaire, ouvre une étape — avec l'accord du visiteur quand la page change —, une fois l'action autorisée dans « Widget › Actions » (D21) |
| Tableaux de bord | Des cartes sur une grille : nombre, tableau, barres, courbes, camembert ; des questions assistées ou en SQL — lu par un rôle qui ne voit que les vues d'analyse, en lecture seule —, l'IA pour écrire la requête ; « Vue d'ensemble » par défaut (D22) |
| Contacts | Drapeau, heure locale et carte OpenStreetMap de chaque contact, tirés du fuseau horaire de son navigateur — sans géolocalisation par IP (D18) |

## Installer avec Docker

La messagerie est publiée en une image, [`eodia/messagerie`](https://hub.docker.com/r/eodia/messagerie)
(amd64 et arm64), qui sert le serveur (port 8810) et l'inbox (port 3210), à côté d'un
PostgreSQL 16 avec pgvector :

```bash
echo "CHAT_SECRET=$(openssl rand -base64 32)" > .env
docker compose up -d       # avec le docker-compose.yml de « Essayer avec Docker »
```

puis http://localhost:3210, qui crée le premier superviseur. Le `docker-compose.yml` d'essai
est dans [Installation](https://eodia.github.io/messagerie/guides/installation/#essayer-avec-docker) ;
la mise en service, derrière HTTPS, dans
[Mise en production](https://eodia.github.io/messagerie/hebergement/production/). Une étiquette
`vX.Y.Z` publie l'image (`.github/workflows/docker-publish.yml`).

## Développer

Prérequis : Node 22 ou plus, Docker, et `corepack enable`.

Sous Windows, lancez la messagerie **depuis Windows** : c'est le plus rapide, et le
rechargement à chaud marche. Dans VS Code, « Exécuter et déboguer › Messagerie » (F5) lance
Node directement, sur le système de la fenêtre. Si le coin inférieur gauche affiche
« WSL: … », la fenêtre est connectée à WSL : cliquez-le, puis « Rouvrir le dossier dans
Windows ». Depuis WSL, un
dossier de `/mnt/c` est lent, et WSL n'y voit pas les fichiers changer : ni `tsx watch` ni
Next ne rechargent. L'installation contient tout de même les binaires natifs des deux
systèmes (`supportedArchitectures` dans `package.json`) ; pour travailler en WSL, clonez
plutôt le dépôt dans le système de fichiers Linux (`~/…`).

```bash
corepack pnpm install
corepack pnpm db:up                          # PostgreSQL 16 + pgvector
corepack pnpm seed                           # vide le schéma chat, y met Acme Assurances et ses conversations
corepack pnpm --filter @chat/widget build    # le script du widget, servi par le serveur
corepack pnpm --filter @chat/server dev      # le serveur sur http://localhost:8810
corepack pnpm --filter @chat/web dev         # l'inbox sur http://localhost:3210
```

Le premier démarrage sur une base vide écrit le paramétrage de démonstration. Ouvrez
l'inbox : l'écran de connexion propose de créer le premier superviseur — ou, après
`pnpm seed`, choisissez le mot de passe de `marc.jamain@exemple.fr` par ce même écran.
En développement, `CHAT_DEV_AGENT=marc.jamain@exemple.fr` dans `apps/server/.env` évite
la connexion. Pour l'IA, ajoutez `CHAT_AI_API_KEY` dans `apps/server/.env`.

- http://localhost:8810/demo : une page d'Acme Assurances avec le widget, en visiteur
  anonyme ou en cliente connectée (`?client=sophie`), et un panneau qui essaie l'API
  JavaScript du widget.
- http://localhost:3210/widget : l'éditeur du widget, avec son aperçu.
- http://localhost:3210/parametrage/boites : l'administration.
- `corepack pnpm --filter @chat/server mcp-demo` : un serveur MCP de démonstration (les
  agences d'Acme, port 8820), que la ligne « Agences Acme » de la démo déclare à l'IA.

Pour voir l'inbox sonner, sans widget ni IA :

```bash
corepack pnpm --filter @chat/server simulate message "Lucas Petit" "Vous avez reçu le rapport ?"
corepack pnpm --filter @chat/server simulate transfert "Julie Martin"
```

```bash
corepack pnpm lint                 # Biome
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm test:int             # un vrai PostgreSQL par Testcontainers (Docker)
```

| Variable | Où | Rôle |
|---|---|---|
| `DATABASE_URL` | serveur | le PostgreSQL du schéma `chat` |
| `CHAT_SECRET` | serveur | signe les jetons des visiteurs ; requis en production, 32 caractères au moins |
| `CHAT_WEB_ORIGIN` | serveur | l'origine de l'inbox, seule admise (CORS, WebSocket, aperçu du widget) |
| `CHAT_TRUST_PROXY` | serveur | `1` derrière un proxy : l'adresse du visiteur est lue dans `X-Forwarded-For` |
| `CHAT_PUBLIC_URL` | serveur | l'adresse publique du serveur : liens signés, retour OIDC ; en `https`, le cookie de session est `Secure` |
| `CHAT_OIDC_ISSUER`, `CHAT_OIDC_CLIENT_ID`, `CHAT_OIDC_CLIENT_SECRET` | serveur | le fournisseur d'identité ; le retour est `{CHAT_PUBLIC_URL}/api/auth/oidc/callback` |
| `CHAT_OIDC_NAME` | serveur | son nom sur le bouton de connexion (« Microsoft », « Google »…) |
| `CHAT_AI_PROVIDER`, `CHAT_AI_BASE_URL` | serveur | `mistral` (défaut), `openai`, `ollama`, ou l'adresse d'un serveur compatible |
| `CHAT_AI_API_KEY` | serveur | sans elle, pas d'IA : les conversations vont aux conseillers |
| `CHAT_AI_MODEL`, `CHAT_AI_EMBEDDING_MODEL` | serveur | `mistral-small-latest` et `mistral-embed` par défaut |
| `CHAT_AI_REDACT` | serveur | `0` pour envoyer les données personnelles telles quelles ; masquées par défaut vers un modèle externe |
| `CHAT_WORKER` | serveur | `separate` : les tâches de l'IA tournent dans `pnpm worker`, pas dans le serveur |
| `CHAT_DEV_AGENT` | serveur | développement seulement : l'adresse du conseiller des requêtes sans session |
| `CHAT_API_URL` | inbox | l'adresse du serveur, lue à chaque requête |

Un secret ne s'écrit jamais dans le paramétrage (D5) : un outil ou un serveur MCP y nomme
la variable d'environnement qui le porte (`${METEO_TOKEN}` dans un en-tête, par exemple).

| Dossier | Contenu |
|---|---|
| [`apps/web`](apps/web) | l'inbox des conseillers — Next.js, shadcn/ui |
| [`apps/server`](apps/server) | le serveur — Hono, WebSocket, Drizzle, pg-boss, migrations dans `drizzle/` |
| [`apps/widget`](apps/widget) | le widget — Preact, esbuild, un seul script |
| [`packages/ai`](packages/ai) | le modèle derrière une interface, le masquage des données personnelles, le découpage des articles |
| [`packages/contracts`](packages/contracts) | les types échangés entre le serveur, l'inbox et le widget |
| [`docs/architecture`](docs/architecture) | les décisions d'architecture |
| [`www`](www) | le site public : la page d'accueil et la documentation — Astro et Starlight |

### L'API et le serveur MCP (D16)

Un superviseur crée un jeton dans « Administration › API et MCP » : à quoi il sert, où il se
prend (API REST, MCP), ses droits (lecture, ou lecture et écriture), ses boîtes, sa
durée. Le jeton ne s'affiche qu'une fois ; gardez-le dans `MESSAGERIE_TOKEN`.

```bash
curl -H "Authorization: Bearer $MESSAGERIE_TOKEN" http://localhost:8810/api/v1/conversations
claude mcp add --transport http messagerie http://localhost:8810/mcp \
  --header "Authorization: Bearer $MESSAGERIE_TOKEN"
```

Les routes sont décrites en tête de `apps/server/src/api/rest.ts` ; les outils MCP
(`list_conversations`, `get_conversation`, `send_reply`, `add_note`…) dans
`apps/server/src/api/mcp.ts`.

### Les webhooks (D17)

Dans le même écran, onglet « Webhooks » : une adresse HTTPS publique, les événements qui la
préviennent (`message.created`, `conversation.resolved`…), ses boîtes. Chaque appel porte
`X-Messagerie-Signature`, à vérifier avec le secret affiché une seule fois ; la
documentation (`/documentation#webhooks`) donne le code. Pour essayer un récepteur sur sa
machine, `CHAT_WEBHOOK_DEV=1` autorise HTTP et les adresses locales.

Le code (identifiants, types, commentaires) est en anglais. Le français est réservé à
ce que lit l'utilisateur et aux documents d'architecture.

## Licence

Logiciel libre d'[Eodia](https://eodia.com/fr/), distribué sous
[GNU Affero General Public License v3.0](LICENSE) ou toute version ultérieure
(`AGPL-3.0-or-later`).
