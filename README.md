# Messagerie

> Nom de travail. Voir [`apps/web/src/lib/product.ts`](apps/web/src/lib/product.ts).

**La messagerie client libre, avec un agent IA en première ligne et un copilote pour les
conseillers. Son paramétrage et sa base de connaissance vivent dans [basedb](https://github.com/eodia/basedb).**

- **Le widget** : un script à coller dans votre site. L'agent IA répond à partir de votre
  base de connaissance, peut appeler des outils (une API, un serveur MCP, une fiche dans
  basedb) et passe la main à un conseiller, avec un résumé, dès qu'il n'est pas sûr de lui.
- **L'inbox** : les boîtes de réception, les conversations, le fil, et ce que le copilote
  propose. Une conversation se transfère d'une boîte ou d'une équipe à l'autre. L'avis du
  conseiller sur chaque réponse de l'IA (acceptée, modifiée, rejetée) nourrit le jeu
  d'évaluation.
- **Le paramétrage, dans l'inbox, stocké dans basedb** : boîtes, équipes, conseillers,
  sites, horaires, réponses types, garde-fous, outils de l'IA, serveurs MCP, articles et
  widget. Les écrans de l'inbox écrivent dans la base « Messagerie » de basedb, qui en garde
  l'historique et les droits, et dont les grilles restent ouvertes.

Les décisions qui expliquent le reste sont dans
[`docs/architecture/00-decisions-structurantes.md`](docs/architecture/00-decisions-structurantes.md).

## État

| Partie | État |
|---|---|
| Modèle basedb « Messagerie » | 13 tables, validé par le validateur de basedb, avec les lignes de démonstration d'Acme Assurances |
| Serveur (`apps/server`) | API de l'inbox et du widget, temps réel par WebSocket et `LISTEN/NOTIFY`, schéma `chat` en Drizzle, tâches pg-boss, tests d'intégration |
| Inbox (`apps/web`) | Boîtes de réception, conversations, transferts, métadonnées, contacts, base de connaissance rédigée sur place (éditeur, publication pour l’IA), pièces jointes lues par l’IA sur demande, réponse enrichie (gras, italique, listes, liens) relue par l’IA pendant la frappe, emoji cherchés en français et GIF GIPHY, mode audio (lecture à voix haute par la voix de Mistral, dictée du navigateur), suppression d’un message pour soi ou pour tout le monde (clic droit), palette Ctrl+K (conversations, contacts, mots des messages, commandes), recherche de la liste au même moteur (`/`, `#étiquette`, `@conseiller`), filtres par étiquette, conseiller, priorité, attente, statistiques ; paramétrage complet ; volets redimensionnables |
| Widget (`apps/widget`) | Preact dans un Shadow DOM, ~60 Ko ; visiteur anonyme ou client connecté (identité signée par le site) ; apparence réglée par site ; API JavaScript `window.MessagerieChat` ; pièces jointes et emoji |
| IA (`packages/ai`) | Mistral par défaut (tout serveur compatible OpenAI) ; réponses sourcées, seuil de confiance, garde-fous, transfert avec résumé, données personnelles masquées |
| Outils de l'IA | Lecture dans basedb, appels HTTP (en-têtes et jetons lus dans l'environnement), rappels, serveurs MCP |
| Alertes | Son, notifications du bureau, pastilles de l'onglet, cloche par conseiller, réglables |
| basedb (0.5.0 et plus) | Un basedb dédié dans `docker compose` ; base créée et reliée par `pnpm basedb:setup` ; conseillers reconnus par introspection de leur jeton ; tables suivies en direct |

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
plutôt le dépôt dans le système de fichiers Linux (`~/…`). Une copie de basedb à côté de ce
dépôt (`../basedb`, ou `BASEDB_DIR`) pour vérifier le modèle.

```bash
corepack pnpm install
corepack pnpm db:up                          # PostgreSQL 16 + pgvector, et basedb 0.5.0 (http://localhost:8890)
corepack pnpm basedb:setup                   # crée la base « Messagerie » (Acme Assurances) et y relie le chat
corepack pnpm seed                           # vide le schéma chat, y met les conversations de démo
corepack pnpm --filter @chat/widget build    # le script du widget, servi par le serveur
corepack pnpm --filter @chat/server dev      # le serveur sur http://localhost:8810
corepack pnpm --filter @chat/web dev         # l'inbox sur http://localhost:3210
```

`db:up` écrit `.env` à la racine au premier lancement : la clé de chiffrement de basedb et
son administrateur (`BASEDB_ADMIN_EMAIL`, `BASEDB_ADMIN_PASSWORD`), générés. Ouvrez l'inbox
et connectez-vous avec ce compte : la mire est celle de basedb, et la session vaut pour les
deux (D4). Pour l'IA, ajoutez `CHAT_AI_API_KEY` dans `apps/server/.env`.

- http://localhost:8810/demo : une page d'Acme Assurances avec le widget, en visiteur
  anonyme ou en cliente connectée (`?client=sophie`), et un panneau qui essaie l'API
  JavaScript du widget.
- http://localhost:3210/widget : l'éditeur du widget, avec son aperçu.
- http://localhost:3210/parametrage/boites : le paramétrage, qui écrit dans basedb.
- `corepack pnpm --filter @chat/server mcp-demo` : un serveur MCP de démonstration (les
  agences d'Acme, port 8820), que la ligne « Agences Acme » de la démo déclare à l'IA.

Sans basedb (ni `BASEDB_*` dans `apps/server/.env`), le serveur prend les lignes de
démonstration du modèle et l'inbox fonctionne au nom de `CHAT_DEV_AGENT` : le paramétrage
change alors en mémoire seulement. Pour un basedb existant, `provision` crée la base, puis
on y émet un jeton d'intégration REST **en écriture** pour `BASEDB_TOKEN` :

```bash
# BASEDB_API_URL, BASEDB_TENANT et un administrateur (BASEDB_ADMIN_TOKEN, ou e-mail et mot de passe)
corepack pnpm --filter @chat/server provision --demo
```

L'inbox doit être servie **sur le même hôte que basedb** (D4) : elle obtient le jeton du
conseiller auprès de sa session basedb. Le paramétrage écrit avec ce jeton : basedb
applique les droits du superviseur.

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
corepack pnpm template:check       # le modèle basedb, passé au validateur de basedb
```

| Variable | Où | Rôle |
|---|---|---|
| `DATABASE_URL` | serveur | le PostgreSQL du schéma `chat` |
| `CHAT_SECRET` | serveur | signe les jetons des visiteurs ; requis en production, 32 caractères au moins |
| `CHAT_WEB_ORIGIN` | serveur | l'origine de l'inbox, seule admise (CORS, WebSocket, aperçu du widget) |
| `CHAT_TRUST_PROXY` | serveur | `1` derrière un proxy : l'adresse du visiteur est lue dans `X-Forwarded-For` |
| `BASEDB_API_URL` | serveur, inbox | l'API de basedb (`/auth/…`, `/api/v1/…`) |
| `BASEDB_TENANT`, `BASEDB_BASE`, `BASEDB_TOKEN` | serveur | le tenant, la base « Messagerie » et le jeton d'intégration du chat |
| `CHAT_AI_PROVIDER`, `CHAT_AI_BASE_URL` | serveur | `mistral` (défaut), `openai`, `ollama`, ou l'adresse d'un serveur compatible |
| `CHAT_AI_API_KEY` | serveur | sans elle, pas d'IA : les conversations vont aux conseillers |
| `CHAT_AI_MODEL`, `CHAT_AI_EMBEDDING_MODEL` | serveur | `mistral-small-latest` et `mistral-embed` par défaut |
| `CHAT_AI_REDACT` | serveur | `0` pour envoyer les données personnelles telles quelles ; masquées par défaut vers un modèle externe |
| `CHAT_WORKER` | serveur | `separate` : les tâches de l'IA tournent dans `pnpm worker`, pas dans le serveur |
| `CHAT_DEV_AGENT` | serveur | développement seulement : le conseiller des requêtes sans jeton |
| `CHAT_API_URL` | inbox | l'adresse du serveur, lue à chaque requête |
| `BASEDB_URL` | inbox | l'adresse de basedb, pour les liens de paramétrage |

Un secret ne s'écrit jamais dans basedb (D5) : un outil ou un serveur MCP y nomme la
variable d'environnement qui le porte (`${METEO_TOKEN}` dans un en-tête, par exemple).

| Dossier | Contenu |
|---|---|
| [`apps/web`](apps/web) | l'inbox des conseillers — Next.js, shadcn/ui, le style de basedb |
| [`apps/server`](apps/server) | le serveur — Hono, WebSocket, Drizzle, pg-boss, migrations dans `drizzle/` |
| [`apps/widget`](apps/widget) | le widget — Preact, esbuild, un seul script |
| [`packages/ai`](packages/ai) | le modèle derrière une interface, le masquage des données personnelles, le découpage des articles |
| [`packages/contracts`](packages/contracts) | les types échangés entre le serveur, l'inbox et le widget |
| [`packages/basedb-template`](packages/basedb-template) | le modèle de la base « Messagerie » |
| [`docs/architecture`](docs/architecture) | les décisions d'architecture |

Le code (identifiants, types, commentaires) est en anglais. Le français est réservé à
ce que lit l'utilisateur et aux documents d'architecture.

## Licence

Logiciel libre d'[Eodia](https://eodia.com/fr/), distribué sous
[GNU Affero General Public License v3.0](LICENSE) ou toute version ultérieure
(`AGPL-3.0-or-later`).
