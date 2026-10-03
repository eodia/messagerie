---
title: Mise en production
description: Déployer la messagerie avec Docker Compose, à côté de PostgreSQL, derrière une passerelle HTTPS.
---

La messagerie est publiée en **une image**, `eodia/messagerie`, qui sert le **serveur** et
l’**inbox**. Elle ne demande qu’un **PostgreSQL** : le paramétrage, les comptes des conseillers
et les conversations vivent tous dans son schéma `chat`. Le `docker-compose.yml` de cette page
l’assemble avec PostgreSQL et une passerelle HTTPS, Caddy. Toute la configuration passe par un
fichier `.env` (voir [Variables d’environnement](/messagerie/hebergement/variables/)).

## Ce qu’il faut

- Un serveur avec **Docker** et Compose v2.
- **Deux noms de domaine**, sous-domaines d’un même domaine à vous, qui pointent vers ce
  serveur, ports 80 et 443 ouverts :
  - un pour l’**inbox** — `support.exemple.fr` dans cette page ;
  - un pour le **serveur** : l’API, la connexion, le temps réel et le script du widget —
    `chat.exemple.fr`.
- Une clé chez un fournisseur d’IA, si l’IA doit répondre (Mistral par défaut).

Les images assemblées :

| Service | Image | Rôle |
|---|---|---|
| `postgres` | `pgvector/pgvector:pg16` | PostgreSQL 16 avec pgvector : le schéma `chat` |
| `messagerie` | `eodia/messagerie:0.1.0` | le serveur et l’inbox |
| `worker` (option) | `eodia/messagerie:0.1.0` | l’IA, les webhooks et les automatisations, dans un processus à part |
| `caddy` | `caddy:2-alpine` | la passerelle HTTPS, certificats Let’s Encrypt |

## L’image

Elle tourne sur Node 22 et sert deux ports :

| Port | Processus | Chemins |
|---|---|---|
| 3210 | l’**inbox** (Next.js) | toute l’application des conseillers, l’écran de connexion, les liens d’invitation (`/invitation/…`) |
| 8810 | le **serveur** | la connexion `/api/auth`, `/api/inbox` et son WebSocket, `/api/widget`, `/widget.js`, `/widget/preview`, `/files/…`, l’API REST `/api/v1`, le serveur MCP `/mcp`, les adresses des automatisations `/api/automations/…/hook`, `/health` |

Au démarrage, le serveur applique les migrations du schéma `chat` (l’extension `vector`
comprise) : sur une base vide, il le crée ; ensuite, il n’ajoute que ce qui manque. Lancée avec
la commande `worker`, l’image ne fait tourner que le worker.

L’image est publiée sur [Docker Hub](https://hub.docker.com/r/eodia/messagerie), pour `amd64` et
`arm64`. Les étiquettes suivent les versions : `eodia/messagerie:0.1.0` pour exactement cette
version, `0.1` pour la dernière de la série, `latest` pour la dernière tout court. Fixez une
version exacte dans `.env` (`MESSAGERIE_VERSION`) plutôt que de suivre la dernière.

L’image tourne sous l’utilisateur `node`, sans droits ; les fichiers des conversations vont dans
le volume `/data/files`. Son contrôle de santé interroge le serveur (`/health`) et l’inbox.

## Deux sous-domaines d’un même domaine

C’est la contrainte qui commande le déploiement. Un conseiller se connecte auprès du
**serveur** : c’est lui qui pose le cookie de session, pour son propre nom. L’inbox, servie
ailleurs, l’appelle avec ce cookie. Un navigateur ne l’envoie que si les deux adresses sont du
**même site** : `support.exemple.fr` et `chat.exemple.fr` le sont, `support.exemple.fr` et
`chat.autre-domaine.fr` ne le sont pas. Un domaine partagé entre clients d’un hébergeur, comme
un sous-domaine de `github.io`, ne convient pas non plus.

Trois variables disent qui est où :

| Variable | Lue par | Ici |
|---|---|---|
| `CHAT_WEB_ORIGIN` | le serveur | `https://support.exemple.fr` : la seule origine admise par CORS, à l’ouverture du WebSocket et dans le cadre de l’aperçu du widget ; les liens d’invitation et des e-mails la prennent pour adresse |
| `CHAT_PUBLIC_URL` | le serveur | `https://chat.exemple.fr` : son adresse publique. Le fournisseur d’identité y renvoie, Twilio y appelle pour les SMS, et le cookie de session n’est `Secure` que si elle commence par `https:` |
| `CHAT_API_URL` | l’inbox | `https://chat.exemple.fr` : le serveur, tel que le navigateur des conseillers le joint |

Pourquoi deux noms plutôt qu’un : l’inbox et le serveur répondent tous deux à `/`, et se
partagent `/widget/…` — l’éditeur du widget à `/widget/<site>`, l’aperçu à `/widget/preview`.
Deux noms, et la passerelle n’a aucun chemin à trier.

## Les fichiers

Trois fichiers, dans un même dossier : `docker-compose.yml`, `Caddyfile` et `.env`. Un quatrième,
`outils.env`, est facultatif.

### `docker-compose.yml`

```yaml
# Messagerie — PostgreSQL, la messagerie et une passerelle HTTPS.
#
#   docker compose up -d                    # tout démarrer
#   docker compose --profile worker up -d   # avec le worker, quand CHAT_WORKER=separate
#
# Rien n'est publié que par Caddy, sur les ports 80 et 443.

name: messagerie

# Ce que le serveur et le worker partagent : l'image, la configuration, les fichiers.
x-messagerie: &messagerie
  image: eodia/messagerie:${MESSAGERIE_VERSION:-0.1.0}
  restart: unless-stopped
  init: true
  depends_on:
    postgres: { condition: service_healthy }
  # Les secrets que les outils de l'IA et les serveurs MCP nomment (${NOM}).
  env_file:
    - path: outils.env
      required: false
  environment:
    NODE_ENV: production
    DATABASE_URL: postgres://messagerie:${POSTGRES_PASSWORD}@postgres:5432/messagerie
    CHAT_SECRET: ${CHAT_SECRET:?définissez CHAT_SECRET dans .env (openssl rand -base64 32)}
    # L'inbox sur un nom, le serveur sur l'autre : deux sous-domaines du même domaine.
    CHAT_WEB_ORIGIN: https://${MESSAGERIE_DOMAIN}
    CHAT_PUBLIC_URL: https://${MESSAGERIE_API_DOMAIN}
    CHAT_API_URL: https://${MESSAGERIE_API_DOMAIN}
    # Derrière Caddy : l'adresse du visiteur est lue dans X-Forwarded-For.
    CHAT_TRUST_PROXY: "1"
    CHAT_FILES_DIR: /data/files
    CHAT_WORKER: ${CHAT_WORKER:-}
    # La connexion par le fournisseur d'identité de l'entreprise (facultatif).
    CHAT_OIDC_ISSUER: ${CHAT_OIDC_ISSUER:-}
    CHAT_OIDC_CLIENT_ID: ${CHAT_OIDC_CLIENT_ID:-}
    CHAT_OIDC_CLIENT_SECRET: ${CHAT_OIDC_CLIENT_SECRET:-}
    CHAT_OIDC_NAME: ${CHAT_OIDC_NAME:-}
    # Les e-mails : liens des comptes, réponses au visiteur parti, alertes (facultatif).
    CHAT_SMTP_URL: ${CHAT_SMTP_URL:-}
    CHAT_MAIL_FROM: ${CHAT_MAIL_FROM:-}
    CHAT_PUSH_SUBJECT: ${CHAT_PUSH_SUBJECT:-}
    # L'IA : sans clé, les conversations vont droit aux conseillers.
    CHAT_AI_PROVIDER: ${CHAT_AI_PROVIDER:-}
    CHAT_AI_BASE_URL: ${CHAT_AI_BASE_URL:-}
    CHAT_AI_API_KEY: ${CHAT_AI_API_KEY:-}
    CHAT_AI_MODEL: ${CHAT_AI_MODEL:-}
    CHAT_AI_EMBEDDING_MODEL: ${CHAT_AI_EMBEDDING_MODEL:-}
    CHAT_AI_VISION_MODEL: ${CHAT_AI_VISION_MODEL:-}
    CHAT_AI_OCR_MODEL: ${CHAT_AI_OCR_MODEL:-}
    CHAT_AI_SPEECH_MODEL: ${CHAT_AI_SPEECH_MODEL:-}
    CHAT_AI_SPEECH_VOICE: ${CHAT_AI_SPEECH_VOICE:-}
    CHAT_AI_REDACT: ${CHAT_AI_REDACT:-}
    CHAT_AI_MIN_SIMILARITY: ${CHAT_AI_MIN_SIMILARITY:-}
    GIPHY_API_KEY: ${GIPHY_API_KEY:-}
    CHAT_WEBHOOK_ALLOW: ${CHAT_WEBHOOK_ALLOW:-}
  volumes:
    - files:/data/files

services:
  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: messagerie
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?définissez POSTGRES_PASSWORD dans .env}
      POSTGRES_DB: messagerie
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U messagerie -d messagerie"]
      interval: 5s
      timeout: 3s
      retries: 30

  messagerie:
    <<: *messagerie

  # CHAT_WORKER=separate : l'IA et les webhooks quittent le serveur pour ce processus.
  worker:
    <<: *messagerie
    command: worker
    profiles: [worker]

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on: [messagerie]
    environment:
      MESSAGERIE_DOMAIN: ${MESSAGERIE_DOMAIN:?définissez MESSAGERIE_DOMAIN dans .env}
      MESSAGERIE_API_DOMAIN: ${MESSAGERIE_API_DOMAIN:?définissez MESSAGERIE_API_DOMAIN dans .env}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"

volumes:
  postgres-data:
  files:
  caddy-data:
  caddy-config:
```

### `Caddyfile`

```txt
# L'inbox des conseillers.
{$MESSAGERIE_DOMAIN} {
	reverse_proxy messagerie:3210
}

# Le serveur : la connexion, l'API, le temps réel, le script du widget, l'API REST et le MCP.
{$MESSAGERIE_API_DOMAIN} {
	reverse_proxy messagerie:8810
}
```

Caddy obtient et renouvelle seul les certificats des deux domaines, transmet les WebSocket et
pose `X-Forwarded-For`, `X-Forwarded-Proto` et `X-Forwarded-Host` : d’où `CHAT_TRUST_PROXY=1`.

### `.env`

```bash
# Les domaines, dont le DNS pointe vers ce serveur : deux sous-domaines du même domaine.
MESSAGERIE_DOMAIN=support.exemple.fr
MESSAGERIE_API_DOMAIN=chat.exemple.fr

# La version.
MESSAGERIE_VERSION=0.1.0

# Générés une fois pour toutes, sauvegardés avec la base.
POSTGRES_PASSWORD=…                 # openssl rand -hex 24 : il entre dans une URL
CHAT_SECRET=…                       # openssl rand -base64 32

# L'IA.
CHAT_AI_API_KEY=

# Le fournisseur d'identité de l'entreprise (facultatif, voir « Comptes et connexion »).
CHAT_OIDC_ISSUER=
CHAT_OIDC_CLIENT_ID=
CHAT_OIDC_CLIENT_SECRET=
CHAT_OIDC_NAME=

# Les e-mails (facultatif, voir « Variables d'environnement »).
CHAT_SMTP_URL=                      # smtps://utilisateur:motdepasse@smtp.exemple.fr:465
CHAT_MAIL_FROM=                     # Support Acme <support@exemple.fr>
```

### `outils.env` (facultatif)

Un outil de l’IA ou un serveur MCP déclaré dans **Administration › Outils IA** ne porte jamais
son secret : il nomme la variable d’environnement qui le tient, `${METEO_TOKEN}` dans un en-tête
par exemple. Ces variables-là vont dans `outils.env`, que le serveur et le worker lisent :

```bash
METEO_TOKEN=…
```

Le jeton d’un compte Twilio, que nomme un numéro de **Administration › Numéros SMS**, y va de
même ([SMS et RCS](/messagerie/fonctionnalites/sms-et-rcs/)) :

```bash
TWILIO_AUTH_TOKEN=…
```

## Première mise en service

1. **Démarrez.**

   ```bash
   docker compose up -d
   docker compose logs messagerie
   ```

   Le serveur crée le schéma `chat`, puis écoute ; le journal dit aussi ce qu’il en est de
   l’IA. La base est vide : ni site, ni boîte, ni conseiller.

2. **Créez le premier superviseur.** Ouvrez https://support.exemple.fr. Tant que personne ne
   peut se connecter, l’écran de connexion devient **Bienvenue dans la messagerie** : donnez un
   **Nom**, une **Adresse e-mail** et un mot de passe, puis **Créer le compte**. Vous voilà
   connecté, superviseur. La messagerie commence avec une automatisation, **Demander l’e-mail
   quand la réponse tarde**, et un tableau de bord, **Vue d’ensemble**.

3. **Réglez l’essentiel**, dans **Administration** :
   - **Équipes et conseillers** : une équipe ;
   - **Boîtes de réception** : une boîte, et l’équipe qui y répond ;
   - **Sites et horaires** : le site, ses **Domaines autorisés**, sa **Boîte de réception** et
     ses horaires.

   Le détail est dans [Paramétrage](/messagerie/fonctionnalites/parametrage/).

4. **Installez le widget.** Dans **Widget**, onglet **Installation**, copiez la ligne à coller
   dans les pages du site :

   ```html
   <script src="https://chat.exemple.fr/widget.js" data-site="…" async></script>
   ```

5. **Invitez les conseillers**, depuis **Équipes et conseillers** : voir
   [Comptes et connexion](/messagerie/hebergement/comptes/).

:::caution[Créez le premier superviseur sans attendre]
Tant qu’il n’existe pas, quiconque ouvre l’inbox peut le créer. Faites-le dès le premier
démarrage — ou n’ouvrez le port 443 qu’ensuite.
:::

## Le worker

Par défaut, le serveur fait tout : le temps réel, et les tâches de fond — réponses et
suggestions de l’IA, étiquettes, résumés, indexation de la base de connaissance, purges de
conservation, envoi des webhooks, automatisations, réveil des conversations mises en attente.
Pour qu’un modèle lent ou un destinataire de webhook lent ne ralentisse jamais le WebSocket,
confiez-les au worker :

```bash
# dans .env
CHAT_WORKER=separate
```

```bash
docker compose --profile worker up -d
```

Le serveur cesse alors de les faire lui-même : **sans worker démarré, elles ne tournent plus.**
Le worker partage le volume des fichiers, car l’IA lit les pièces jointes. Les deux processus se
parlent par PostgreSQL (`LISTEN/NOTIFY` et la file pg-boss) : ni Redis ni autre service.

## HTTPS et passerelle

Avec le Caddyfile de cette page, il n’y a rien à faire : Caddy obtient les certificats au
premier appel et sert tout en HTTPS. `CHAT_PUBLIC_URL` en `https://` rend le cookie de session
`Secure`.

Derrière une autre passerelle — nginx, Traefik, un répartiteur de charge — il faut :

- servir les deux noms en HTTPS, l’un vers le port 3210, l’autre vers le port 8810 ;
- transmettre les WebSocket : `/api/inbox/events` pour l’inbox, `/api/widget/…` pour le
  widget ;
- poser `X-Forwarded-For` (et `X-Forwarded-Proto`, `X-Forwarded-Host`) en **remplaçant** ce
  que le client envoie, puis définir `CHAT_TRUST_PROXY=1`.

`CHAT_TRUST_PROXY` ne se définit que derrière une passerelle : sans elle, ces en-têtes seraient
à qui veut les écrire. Le serveur s’en sert pour l’adresse du visiteur, pour les limites
d’essais de la connexion, et pour l’adresse publique que donne la documentation de l’API.

## Les mises à jour

```bash
# dans .env : MESSAGERIE_VERSION=0.2.0
docker compose pull
docker compose up -d
```

Le serveur applique ses nouvelles migrations au démarrage : rien d’autre à lancer, le
paramétrage compris. Les sessions des conseillers sont gardées en base : une mise à jour ne
les déconnecte pas.

## Les sauvegardes

Tout ce qui compte tient en trois choses :

| Quoi | Où | Contenu |
|---|---|---|
| la base PostgreSQL | volume `postgres-data` | le schéma `chat` : paramétrage, conseillers et leurs sessions, conversations, contacts, secrets des sites, jetons de l’API, webhooks ; et la file des tâches (schéma `pgboss`) |
| les fichiers des conversations | volume `files` (`CHAT_FILES_DIR`) | les pièces jointes, jamais en base |
| `.env` et `outils.env` | le dossier du déploiement | les clés, sans lesquelles une sauvegarde ne se relit pas entièrement |

```bash
docker compose exec -T postgres pg_dump -U messagerie -Fc messagerie > messagerie-$(date +%F).dump
docker run --rm -v messagerie_files:/files -v "$PWD":/sauvegarde alpine \
  tar czf /sauvegarde/fichiers-$(date +%F).tgz -C /files .
```

La base de ce déploiement ne sert qu’à la messagerie : la sauvegarder entière garde aussi
l’extension `vector`. Si la messagerie partage un PostgreSQL avec d’autres applications,
`pg_dump -n chat -n analytics` ne prend que ses schémas — `analytics` porte les vues des
tableaux de bord ; l’extension `vector` est alors à recréer (`CREATE EXTENSION vector`) avant de
restaurer.

Le rôle `chat_analytics`, qui lit ces vues pour les questions en SQL des
[tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/), appartient à l’instance
PostgreSQL, pas à la base : `pg_dump` ne l’emporte pas. Sur une nouvelle instance, recréez-le
avant de restaurer :

```sql
CREATE ROLE chat_analytics NOLOGIN;
GRANT chat_analytics TO messagerie;
```

Sans lui, les questions en SQL sont refusées ; les questions assistées fonctionnent toujours.

:::caution[Les clés vont avec la base]
`CHAT_SECRET` signe les jetons des visiteurs, les liens des fichiers et l’aller-retour chez le
fournisseur d’identité, et scelle les secrets des webhooks. Le changer invalide les jetons des
visiteurs et les liens déjà donnés, et rend les secrets des webhooks illisibles : il faut alors
recréer les webhooks. Les sessions des conseillers, elles, n’en dépendent pas.

Générez-le une fois, et sauvegardez-le avec la base.
:::

## Commandes utiles

```bash
docker compose ps                     # état et santé des services
docker compose logs -f messagerie     # suivre le serveur et l’inbox
docker compose restart messagerie     # redémarrer la messagerie
docker compose down                   # arrêter (les volumes restent)
```

Au démarrage, le journal du serveur dit ce qu’il a trouvé : l’IA —
`chat : IA mistral-small-latest, données personnelles masquées`, ou
`chat : IA désactivée — CHAT_AI_API_KEY absent ; les conversations vont aux conseillers` — et,
s’il y en a un, le fournisseur d’identité : `chat : connexion par Microsoft (…)`.
