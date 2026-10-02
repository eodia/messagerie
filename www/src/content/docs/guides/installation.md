---
title: Installation
description: Lancer la messagerie sur votre machine pour l’essayer ou la développer, puis la mettre en service.
---

La messagerie tient en trois applications d’un même dépôt — le **serveur** (`apps/server`),
l’**inbox** (`apps/web`) et le **widget** (`apps/widget`) — et ne demande qu’une chose à côté :
**PostgreSQL 16 avec pgvector**. Pour l’essayer, `docker compose` le fournit ; pour la mettre
en service, voir [plus bas](#mettre-en-service).

## Prérequis

- **Node 22** ou plus, et `corepack enable` (le dépôt utilise pnpm).
- **Docker**, avec Compose v2.

:::note[Sous Windows]
Lancez la messagerie **depuis Windows**, pas depuis WSL sur un dossier de `/mnt/c` : c’est plus
rapide, et le rechargement à chaud marche. Dans VS Code, **Exécuter et déboguer › Messagerie**
(F5) lance tout. Pour travailler en WSL, clonez le dépôt dans le système de fichiers Linux
(`~/…`).
:::

## Pour essayer et développer

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

En production, la messagerie est publiée en une image Docker, `eodia/messagerie`, qui sert le
serveur et l’inbox, à côté d’un PostgreSQL avec pgvector. Quelques points à retenir avant de
commencer :

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
