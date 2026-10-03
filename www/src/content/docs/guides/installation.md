---
title: Installation
description: Lancer la messagerie avec Docker en deux minutes, la mettre en service, ou la faire tourner depuis ses sources pour la développer.
---

La messagerie est publiée en **une image Docker**, [`eodia/messagerie`](https://hub.docker.com/r/eodia/messagerie),
qui sert le **serveur** et l’**inbox**. À côté, elle ne demande qu’une chose : **PostgreSQL 16
avec pgvector**. Ni Redis, ni file de messages : le temps réel et les tâches de fond passent par
PostgreSQL lui-même.

| Pour… | Le chemin |
|---|---|
| l’essayer sur votre machine | [Essayer avec Docker](#essayer-avec-docker) : un `docker-compose.yml`, deux minutes |
| la mettre en service | [Mise en production](/messagerie/hebergement/production/) : la même image, derrière HTTPS |
| la développer | [Depuis les sources](#depuis-les-sources) : Node 22, pnpm et le dépôt |

## Essayer avec Docker

Il ne faut que **Docker**, avec Compose v2. Dans un dossier vide, créez ce `docker-compose.yml` :

```yaml
# La Messagerie sur votre machine : PostgreSQL et la messagerie, sur localhost.
name: messagerie-essai

services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: messagerie
      POSTGRES_PASSWORD: messagerie
      POSTGRES_DB: messagerie
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U messagerie -d messagerie"]
      interval: 5s
      timeout: 3s
      retries: 30

  messagerie:
    image: eodia/messagerie:${MESSAGERIE_VERSION:-latest}
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://messagerie:messagerie@postgres:5432/messagerie
      CHAT_SECRET: ${CHAT_SECRET:?définissez CHAT_SECRET dans .env}
      # L'inbox sur le port 3210, le serveur sur le port 8810.
      CHAT_WEB_ORIGIN: http://localhost:3210
      CHAT_PUBLIC_URL: http://localhost:8810
      CHAT_API_URL: http://localhost:8810
      # L'IA (facultatif) : sans clé, les conversations vont aux conseillers.
      CHAT_AI_API_KEY: ${CHAT_AI_API_KEY:-}
    ports:
      - "127.0.0.1:3210:3210"
      - "127.0.0.1:8810:8810"
    volumes:
      - files:/data/files

volumes:
  postgres-data:
  files:
```

Puis, dans le même dossier :

```bash
echo "CHAT_SECRET=$(openssl rand -base64 32)" > .env   # la clé de l'instance, une fois pour toutes
docker compose up -d
docker compose logs -f messagerie                      # jusqu'à « à l'écoute sur … »
```

Au premier démarrage, le serveur crée son schéma dans PostgreSQL ; l’image se dit saine
(`docker compose ps`) dès que le serveur et l’inbox répondent. Ouvrez alors
**http://localhost:3210** : l’écran **Bienvenue dans la messagerie** crée le premier superviseur
— **Nom**, **Adresse e-mail**, **Mot de passe** deux fois (8 caractères au moins), puis **Créer
le compte**. La base est vide : réglez un site, une boîte et une équipe dans **Administration**,
comme le montrent les [premiers pas](/messagerie/guides/premiers-pas/).

Pour que l’IA réponde, ajoutez une clé Mistral au `.env`, puis relancez :

```bash
echo "CHAT_AI_API_KEY=…" >> .env
docker compose up -d
```

Pour un autre fournisseur — OpenAI, Ollama, tout serveur compatible OpenAI —, ajoutez ses
variables au bloc `environment` (voir
[Variables d’environnement](/messagerie/hebergement/variables/#intelligence-artificielle)).

| Commande | Pour |
|---|---|
| `docker compose ps` | l’état et la santé des services |
| `docker compose logs -f messagerie` | suivre le serveur et l’inbox |
| `docker compose pull && docker compose up -d` | passer à la dernière version ; le serveur applique ses migrations au démarrage |
| `docker compose down` | arrêter, en gardant les données |
| `docker compose down -v` | tout effacer, base et fichiers compris |

:::note[Sur localhost seulement]
Ce fichier publie les ports sur `127.0.0.1`, en HTTP : il sert à essayer. Pour des conseillers
et des visiteurs venus d’ailleurs, il faut HTTPS, deux noms de domaine et une sauvegarde : c’est
la [mise en production](/messagerie/hebergement/production/), avec la même image.
:::

### Avec votre PostgreSQL

L’image se lance aussi seule, à côté d’un PostgreSQL 16 qui a l’extension **pgvector** :

```bash
docker run -d --name messagerie \
  -p 3210:3210 -p 8810:8810 \
  -v messagerie-files:/data/files \
  -e DATABASE_URL=postgres://messagerie:…@db.exemple.fr:5432/messagerie \
  -e CHAT_SECRET="$(openssl rand -base64 32)" \
  -e CHAT_WEB_ORIGIN=http://localhost:3210 \
  -e CHAT_PUBLIC_URL=http://localhost:8810 \
  -e CHAT_API_URL=http://localhost:8810 \
  eodia/messagerie
```

L’utilisateur de `DATABASE_URL` doit pouvoir créer l’extension `vector` (ou la trouver déjà
créée) et, pour les questions en SQL des tableaux de bord, le rôle `chat_analytics`. Gardez la
valeur de `CHAT_SECRET` : la changer invalide les liens déjà donnés.

### L’image

| | |
|---|---|
| Image | `eodia/messagerie`, sur Docker Hub, pour `amd64` et `arm64` |
| Étiquettes | `0.1.0` (une version exacte), `0.1` (la dernière de la série), `latest` |
| Ports | `3210` l’inbox, `8810` le serveur — l’API, la connexion, le temps réel, `/widget.js` |
| Volume | `/data/files` : les pièces jointes des conversations |
| Commande | aucune : le serveur et l’inbox ; `worker` : le [worker](/messagerie/hebergement/production/#le-worker) seul |
| Utilisateur | `node`, sans droits |
| Santé | le serveur (`/health`) et l’inbox répondent |

Toute la configuration passe par des variables d’environnement : voir
[Variables d’environnement](/messagerie/hebergement/variables/).

## Depuis les sources

Pour développer la messagerie, ou la lire de près. Elle tient en trois applications d’un même
dépôt — le **serveur** (`apps/server`), l’**inbox** (`apps/web`) et le **widget**
(`apps/widget`) —, et PostgreSQL vient de `docker compose`.

### Prérequis

- **Node 22** ou plus, et `corepack enable` (le dépôt utilise pnpm).
- **Docker**, avec Compose v2.

:::note[Sous Windows]
Lancez la messagerie **depuis Windows**, pas depuis WSL sur un dossier de `/mnt/c` : c’est plus
rapide, et le rechargement à chaud marche. Dans VS Code, **Exécuter et déboguer › Messagerie**
(F5) lance tout. Pour travailler en WSL, clonez le dépôt dans le système de fichiers Linux
(`~/…`).
:::

### Lancer

```bash
corepack pnpm install
corepack pnpm db:up                          # PostgreSQL 16 + pgvector
corepack pnpm seed                           # vide le schéma chat, y met Acme Assurances et ses conversations
corepack pnpm --filter @chat/ai build        # le paquet de l’IA, que le serveur consomme compilé
corepack pnpm --filter @chat/widget build    # le script du widget, servi par le serveur
corepack pnpm --filter @chat/server dev      # le serveur, http://localhost:8810
corepack pnpm --filter @chat/web dev         # l’inbox, http://localhost:3210
```

Ce que fait chaque étape :

- **`db:up`** démarre `docker compose` : un PostgreSQL 16 avec pgvector, publié sur
  `127.0.0.1:55440` seulement. Le serveur le trouve sans configuration.
- **`seed`** **vide** le schéma `chat` — paramétrage et comptes compris —, puis y écrit la
  démonstration : le paramétrage d’**Acme Assurances** (son site, ses boîtes de réception, ses
  équipes, ses articles…), des conversations, et l’automatisation de départ, **Demander l’e-mail
  quand la réponse tarde**. Il refuse de tourner en production.
- **`@chat/ai build`** compile le paquet de l’IA : le serveur ne démarre pas sans lui, même sans
  clé d’IA. À refaire après chaque modification de `packages/ai`.
- Le **serveur** applique ses migrations à chaque démarrage. Sur une base dont le paramétrage est
  vide, il y écrit la démonstration d’Acme Assurances : sans `seed`, on a donc le paramétrage,
  mais aucune conversation.

| Adresse | Ce qu’on y trouve |
|---|---|
| http://localhost:3210 | l’inbox |
| http://localhost:3210/widget | l’éditeur du widget, avec son aperçu |
| http://localhost:3210/parametrage/boites | l’administration |
| http://localhost:8810/demo | une page d’Acme Assurances avec le widget, un panneau qui essaie son API JavaScript, et trois [actions de la page](/messagerie/integrations/actions-de-page/) — un tarif, un devis, une section |
| http://localhost:8810/demo?client=sophie | la même, en cliente connectée (identité signée par le site) |
| `127.0.0.1:55440` | PostgreSQL (`chat` / `chat`) |

### Se connecter

Ouvrez l’inbox. Personne n’a encore de mot de passe : l’écran de connexion s’ouvre sur
**Bienvenue dans la messagerie** et crée le premier superviseur — **Nom**, **Adresse e-mail**,
**Mot de passe** deux fois, puis **Créer le compte**. Le mot de passe compte 8 caractères au
moins, et ne peut pas être l’adresse.

La démonstration a déjà son superviseur, **Marc JAMAIN**, sans mot de passe. Entrez son adresse,
`marc.jamain@exemple.fr`, sur ce même écran, avec un nom et un mot de passe : son compte devient
le vôtre, avec ses équipes et ses conversations. `seed` vidant aussi les comptes, l’écran revient
après chaque `seed`.

Pour ne pas se connecter du tout sur une machine de développement, ajoutez à
`apps/server/.env` (le modèle `apps/server/.env.example` l’a déjà) :

```bash
CHAT_DEV_AGENT=marc.jamain@exemple.fr
```

L’inbox s’ouvre alors directement, et chaque requête sans session est faite au nom de ce
conseiller. Ce raccourci est ignoré en production. Les
[premiers pas](/messagerie/guides/premiers-pas/) font le tour.

### La clé d’IA

Sans clé, pas d’IA : chaque conversation va droit aux conseillers. Ajoutez-la dans
`apps/server/.env`, puis relancez le serveur :

```bash
CHAT_AI_API_KEY=…            # une clé Mistral : le fournisseur par défaut
```

Pour un autre fournisseur — OpenAI, Ollama, tout serveur compatible OpenAI —, voir
[Variables d’environnement](/messagerie/hebergement/variables/#intelligence-artificielle). Un
modèle servi sur `localhost` (Ollama) n’a pas besoin de clé.

### Pour aller plus loin

```bash
# un serveur MCP de démonstration (les agences d’Acme, port 8820), déclaré à l’IA par la démo
corepack pnpm --filter @chat/server mcp-demo

# voir l’inbox sonner, sans widget ni IA
corepack pnpm --filter @chat/server simulate message "Lucas Petit" "Vous avez reçu le rapport ?"
corepack pnpm --filter @chat/server simulate transfert "Julie Martin"
```

```bash
corepack pnpm lint                 # Biome
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm test:int             # un vrai PostgreSQL par Testcontainers (Docker)
```

## Mettre en service

En production, c’est [la même image](#limage), `eodia/messagerie`, derrière une passerelle
HTTPS, à côté d’un PostgreSQL avec pgvector. Quelques points à retenir avant de commencer :

- **`CHAT_SECRET`** est obligatoire, 32 caractères au moins : le serveur refuse de démarrer
  sans lui.
- **L’inbox et le serveur partagent un site** — `app.exemple.fr` et `api.exemple.fr`, ou le même
  hôte : la session du conseiller est un cookie du serveur.
- **Rien n’est écrit d’avance** : en production, le serveur crée son schéma, mais pas la
  démonstration. Le premier superviseur se crée à l’écran de connexion, puis il invite les
  autres et règle le reste dans **Administration**. La messagerie commence avec une
  automatisation, **Demander l’e-mail quand la réponse tarde**, et un tableau de bord, **Vue
  d’ensemble**.
- **Les questions en SQL des tableaux de bord** demandent que l’utilisateur de la base puisse
  créer un rôle, `chat_analytics` : c’est le cas avec le `docker compose` de la mise en
  production. Sans lui, seules les questions assistées fonctionnent (voir
  [Tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/#quand-le-sql-est-indisponible)).

Le déploiement est détaillé dans [Mise en production](/messagerie/hebergement/production/) ; la
connexion des conseillers, mot de passe et fournisseur d’identité (OpenID Connect), dans
[les comptes](/messagerie/hebergement/comptes/).

## Et ensuite ?

- [Premiers pas](/messagerie/guides/premiers-pas/) : se connecter, inviter un conseiller, régler
  un site, voir l’IA répondre et reprendre la main.
- [Variables d’environnement](/messagerie/hebergement/variables/) : IA, comptes, fichiers,
  webhooks, adresses.
