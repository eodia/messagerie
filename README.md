# Messagerie

> Nom de travail. Voir [`apps/web/src/lib/product.ts`](apps/web/src/lib/product.ts).

**La messagerie client libre, avec un agent IA en première ligne et un copilote pour les
conseillers. Son paramétrage et sa base de connaissance vivent dans [basedb](https://github.com/eodia/basedb).**

- **Le widget** : un script à coller dans votre site. L'agent IA répond à partir de votre
  base de connaissance, cite ses sources et passe la main à un conseiller, avec un
  résumé, dès qu'il n'est pas sûr de lui.
- **L'inbox** : les conversations, le fil, et ce que le copilote propose. L'avis du
  conseiller sur chaque réponse de l'IA (acceptée, modifiée, rejetée) nourrit le jeu
  d'évaluation.
- **Le paramétrage dans basedb** : sites, horaires, équipes, conseillers, réponses types,
  articles, garde-fous et outils de l'IA. On les édite dans les grilles de basedb, avec
  leur historique et leurs droits.

Les décisions qui expliquent le reste sont dans
[`docs/architecture/00-decisions-structurantes.md`](docs/architecture/00-decisions-structurantes.md).

## État

| Partie | État |
|---|---|
| Modèle basedb « Messagerie » | Écrit, validé par le validateur de basedb |
| Serveur (`apps/server`) | API de l'inbox, temps réel par WebSocket et `LISTEN/NOTIFY`, schéma `chat` en Drizzle, tests d'intégration |
| Inbox (`apps/web`) | Branchée sur le serveur : liste, fil, réponses, notes, prise en main, résolution, avis sur l'IA |
| basedb (0.5.0 et plus) | Base « Messagerie » créée par `pnpm provision` ; conseillers reconnus par introspection de leur jeton basedb ; « Conseillers » suivie en direct |
| Alertes | Son, notifications du bureau, pastilles de l'onglet, cloche par conseiller, réglables |
| IA (`packages/ai`) | À venir ; les réponses et suggestions de la démo sont enregistrées d'avance |
| Widget (`apps/widget`) | À venir |

## Développer

Prérequis : Node 22 ou plus, Docker, et `corepack enable`. Une copie de basedb à côté de ce
dépôt (`../basedb`, ou `BASEDB_DIR`) pour vérifier le modèle.

```bash
corepack pnpm install
corepack pnpm db:up                          # PostgreSQL 16 + pgvector, sur 127.0.0.1:55440
cp apps/server/.env.example apps/server/.env
corepack pnpm seed                           # vide le schéma chat, y met les conversations de démo
corepack pnpm --filter @chat/server dev      # le serveur sur http://localhost:8810
corepack pnpm --filter @chat/web dev         # l'inbox sur http://localhost:3210
```

Sans basedb, l'inbox fonctionne au nom de `CHAT_DEV_AGENT`. Pour la brancher sur basedb :

```bash
# BASEDB_API_URL, BASEDB_TENANT et un administrateur (BASEDB_ADMIN_TOKEN, ou e-mail et mot de passe)
corepack pnpm --filter @chat/server provision
# puis, dans basedb, un jeton d'intégration de la base créée : BASEDB_BASE et BASEDB_TOKEN
```

L'inbox reçoit alors `BASEDB_API_URL` elle aussi, et doit être servie **sur le même hôte
que basedb** (D4) : elle obtient le jeton du conseiller auprès de sa session basedb.

Pour voir l'inbox sonner, sans widget ni IA :

```bash
corepack pnpm --filter @chat/server simulate message "Lucas Petit" "Vous avez reçu le rapport ?"
corepack pnpm --filter @chat/server simulate transfert "Julie Martin"
```

```bash
corepack pnpm lint                 # Biome
corepack pnpm typecheck
corepack pnpm test:int             # un vrai PostgreSQL par Testcontainers
corepack pnpm template:check       # le modèle basedb, passé au validateur de basedb
```

| Variable | Où | Rôle |
|---|---|---|
| `DATABASE_URL` | serveur | le PostgreSQL du schéma `chat` |
| `BASEDB_API_URL` | serveur, inbox | l'API de basedb (`/auth/…`, `/api/v1/…`) |
| `BASEDB_TENANT`, `BASEDB_BASE`, `BASEDB_TOKEN` | serveur | le tenant, la base « Messagerie » et le jeton d'intégration du chat |
| `CHAT_DEV_AGENT` | serveur | développement seulement : le conseiller des requêtes sans jeton |
| `CHAT_WEB_ORIGIN` | serveur | l'origine de l'inbox, seule admise (CORS et WebSocket) |
| `CHAT_API_URL` | inbox | l'adresse du serveur, lue à chaque requête |
| `BASEDB_URL` | inbox | l'adresse de basedb, pour les liens de paramétrage |

| Dossier | Contenu |
|---|---|
| [`apps/web`](apps/web) | l'inbox des conseillers — Next.js, shadcn/ui, le style de basedb |
| [`apps/server`](apps/server) | le serveur — Hono, WebSocket, Drizzle, migrations dans `drizzle/` |
| [`packages/contracts`](packages/contracts) | les types échangés entre le serveur et l'inbox |
| [`packages/basedb-template`](packages/basedb-template) | le modèle de la base « Messagerie » |
| [`docs/architecture`](docs/architecture) | les décisions d'architecture |

Le code (identifiants, types, commentaires) est en anglais. Le français est réservé à
ce que lit l'utilisateur et aux documents d'architecture.

## Licence

Logiciel libre d'[Eodia](https://eodia.com/fr/), distribué sous
[GNU Affero General Public License v3.0](LICENSE) ou toute version ultérieure
(`AGPL-3.0-or-later`).
