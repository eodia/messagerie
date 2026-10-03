---
title: Variables d’environnement
description: Toutes les variables lues par le serveur, le worker et l’inbox de la messagerie, et leur valeur par défaut.
---

Le serveur et le worker lisent les mêmes variables ; l’inbox n’en lit qu’une, `CHAT_API_URL`.
**Une valeur vide vaut « non défini ».** Chaque défaut est celui qui marche sur un poste de
développement, avec le `docker compose` du dépôt.

| Où | Fichier |
|---|---|
| en production, avec Docker Compose | `.env`, à côté de `docker-compose.yml` ; les secrets des outils de l’IA dans `outils.env` — voir [Mise en production](/messagerie/hebergement/production/) |
| en développement, le serveur | `apps/server/.env` (modèle commenté : `apps/server/.env.example`) |
| en développement, l’inbox | `apps/web/.env.local` |

## À définir en production

| Variable | Rôle |
|---|---|
| `NODE_ENV` | `production`. Rend `CHAT_SECRET` obligatoire, ignore `CHAT_DEV_AGENT` (une requête sans session est refusée), n’écrit pas la démonstration dans une base vide, retire la page `/demo`, refuse une requête du widget sans origine, et interdit `seed` |
| `CHAT_SECRET` | signe les jetons des visiteurs, les liens des fichiers et l’aller-retour chez le fournisseur d’identité, scelle les secrets des webhooks, et donne la clé des alertes sur le téléphone. **32 caractères au moins** : `openssl rand -base64 32`. Sans lui, le serveur ne démarre pas en production ; en développement, un secret fixe le remplace. Le changer rend illisibles les secrets des webhooks, et chaque téléphone doit réactiver ses alertes ; les sessions des conseillers n’en dépendent pas |
| `DATABASE_URL` | le PostgreSQL du schéma `chat` (voir plus bas) |
| `CHAT_WEB_ORIGIN`, `CHAT_PUBLIC_URL`, `CHAT_API_URL` | où sont l’inbox et le serveur (voir plus bas) : leurs défauts visent `localhost` |

## Serveur

| Variable | Défaut | Rôle |
|---|---|---|
| `CHAT_PORT` | `8810` | le port du serveur : connexion, API, WebSocket, script du widget, API REST, MCP |
| `CHAT_PUBLIC_URL` | `http://localhost:` suivi de `CHAT_PORT` | l’adresse publique du serveur, sans `/` final. Le fournisseur d’identité y renvoie (`/api/auth/oidc/callback`), Twilio y appelle pour chaque SMS (`/channels/twilio/…`) et y lit les fichiers envoyés en RCS, et le cookie de session n’est `Secure` que si elle commence par `https:` |
| `CHAT_WEB_ORIGIN` | `http://localhost:3210` | l’origine de l’inbox, seule admise : CORS, ouverture du WebSocket, cadre de l’aperçu du widget. Les liens d’invitation et ceux des e-mails la prennent pour adresse, et le retour du fournisseur d’identité y ramène |
| `CHAT_TRUST_PROXY` | — | `1` derrière une passerelle : l’adresse du visiteur et celle de qui se connecte sont lues dans `X-Forwarded-For`, l’adresse publique dans `X-Forwarded-Proto` et `X-Forwarded-Host`. Sans passerelle, laissez-la vide : ces en-têtes seraient à qui veut les écrire |
| `CHAT_WORKER` | — | `separate` : les tâches de fond (IA, webhooks, automatisations, réveil des conversations en attente) quittent le serveur pour le worker, qu’il faut alors lancer |

L’inbox et le serveur doivent partager un site — deux sous-domaines du même domaine, ou le même
nom : le cookie de session est celui du serveur. Voir
[Mise en production](/messagerie/hebergement/production/#deux-sous-domaines-dun-même-domaine).

## Connexion par un fournisseur d’identité

Facultatives : sans elles, les conseillers se connectent par mot de passe seulement. Le bouton
de connexion ne paraît que si `CHAT_OIDC_ISSUER` et `CHAT_OIDC_CLIENT_ID` sont définis. Voir
[Comptes et connexion](/messagerie/hebergement/comptes/#openid-connect).

| Variable | Défaut | Rôle |
|---|---|---|
| `CHAT_OIDC_ISSUER` | — | l’émetteur OpenID Connect : `https://login.microsoftonline.com/<locataire>/v2.0`, `https://accounts.google.com`, `https://sso.exemple.fr/realms/<royaume>`… |
| `CHAT_OIDC_CLIENT_ID` | — | l’identifiant du client déclaré chez le fournisseur |
| `CHAT_OIDC_CLIENT_SECRET` | — | son secret ; vide pour un client public |
| `CHAT_OIDC_NAME` | `SSO` | le nom sur le bouton : **Continuer avec Microsoft** |

## Base de données

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | `postgres://chat:chat@127.0.0.1:55440/chat` | PostgreSQL 16 avec l’extension pgvector. Le serveur y crée et migre le schéma `chat` à chaque démarrage : paramétrage, comptes, conversations. La file des tâches (pg-boss, schéma `pgboss`) et le temps réel (`LISTEN/NOTIFY`) y passent aussi. Le rôle doit pouvoir créer l’extension `vector` ; pour les questions en SQL des tableaux de bord, il doit aussi pouvoir créer le rôle `chat_analytics`, qui lit le schéma `analytics` et rien d’autre — sans lui, seules les questions assistées fonctionnent ([tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/#quand-le-sql-est-indisponible)) |

## Inbox

L’inbox la lit à chaque requête, pas à la construction : la même image sert toute instance.

| Variable | Défaut | Rôle |
|---|---|---|
| `CHAT_API_URL` | `http://localhost:8810` | l’adresse du serveur, telle que le **navigateur** des conseillers la joint : la connexion, l’API, le WebSocket, l’aperçu du widget et la ligne d’installation du widget |

## Intelligence artificielle

Sans clé, et sans modèle servi sur `localhost`, pas d’IA : chaque conversation va droit aux
conseillers.

| Variable | Défaut | Rôle |
|---|---|---|
| `CHAT_AI_PROVIDER` | `mistral` | `mistral`, `openai` ou `ollama` (`http://localhost:11434/v1`) |
| `CHAT_AI_BASE_URL` | l’adresse du fournisseur | tout serveur compatible OpenAI : Azure, vLLM, une passerelle |
| `CHAT_AI_API_KEY` | — | la clé du fournisseur ; facultative pour un modèle sur `localhost` ou `127.0.0.1` |
| `CHAT_AI_MODEL` | `mistral-small-latest` | le modèle des réponses, du copilote, des étiquettes et des résumés |
| `CHAT_AI_EMBEDDING_MODEL` | `mistral-embed` | le modèle des vecteurs de la base de connaissance (1024 dimensions, celles du schéma) |
| `CHAT_AI_VISION_MODEL` | `CHAT_AI_MODEL` | le modèle qui lit les images jointes |
| `CHAT_AI_OCR_MODEL` | `mistral-ocr-latest` chez Mistral, aucun ailleurs | lit les PDF joints ; `off` pour s’en passer |
| `CHAT_AI_SPEECH_MODEL` | `voxtral-mini-tts-latest` chez Mistral, aucun ailleurs | lit les messages à voix haute en mode audio ; `off` : la voix du navigateur |
| `CHAT_AI_SPEECH_VOICE` | `fr_marie_neutral` chez Mistral | la voix de ce modèle |
| `CHAT_AI_REDACT` | masquage si le modèle est externe | `0` : les données personnelles partent telles quelles. Un modèle est externe sauf sur `localhost`, `127.0.0.1`, `::1` ou un nom en `.internal` |
| `CHAT_AI_MIN_SIMILARITY` | `0.7` | la similarité au-dessous de laquelle un passage de la base de connaissance n’est pas une source |

Au démarrage, le journal dit ce qu’il en est : `chat : IA mistral-small-latest, données
personnelles masquées`, ou `chat : IA désactivée — CHAT_AI_API_KEY absent ; les conversations
vont aux conseillers`.

## Fichiers et GIF

| Variable | Défaut | Rôle |
|---|---|---|
| `CHAT_FILES_DIR` | `.files`, dans le dossier de travail du processus | où sont gardés les fichiers envoyés dans les conversations, jamais en base. Le serveur et le worker doivent voir le même dossier |
| `GIPHY_API_KEY` | — | la clé GIPHY des GIF que les conseillers envoient. Sans elle, la palette n’a que les emoji. La recherche passe par le serveur : la clé n’atteint jamais un navigateur |

## E-mails

Facultatives : sans serveur SMTP, la messagerie n’écrit aucun e-mail — les liens des comptes se
transmettent à la main, et rien ne part au visiteur. Voir
[Comptes et connexion](/messagerie/hebergement/comptes/#inviter-un-conseiller) et
[le widget](/messagerie/fonctionnalites/widget/#laissez-nous-votre-e-mail).

| Variable | Défaut | Rôle |
|---|---|---|
| `CHAT_SMTP_URL` | — | le serveur SMTP : `smtp://utilisateur:motdepasse@smtp.exemple.fr:587` (STARTTLS), ou `smtps://…:465` (TLS dès la connexion). Un caractère spécial du mot de passe s’écrit encodé (`%40` pour `@`). En développement, `smtp://127.0.0.1:1025` : le Mailpit du `docker compose` du dépôt, lu à `http://localhost:8025` |
| `CHAT_MAIL_FROM` | `Messagerie <messagerie@localhost>` hors production | l’expéditeur : `Support Acme <support@exemple.fr>`. Requis en production avec `CHAT_SMTP_URL` : le serveur ne démarre pas sans lui |

## Alertes sur le téléphone

Rien à définir : la clé des alertes (VAPID) est tirée de `CHAT_SECRET`. Les services de push
des navigateurs demandent seulement qui les appelle.

| Variable | Défaut | Rôle |
|---|---|---|
| `CHAT_PUSH_SUBJECT` | `CHAT_WEB_ORIGIN` s’il est en `https:`, sinon `mailto:` et l’adresse de `CHAT_MAIL_FROM` | une adresse `mailto:` ou `https:` où les services de push (Apple, Google, Mozilla, Microsoft) peuvent écrire à l’exploitant |

Le téléphone d’un conseiller doit joindre l’inbox en HTTPS : un navigateur ne propose les
alertes qu’à une page sûre. Voir [Alertes](/messagerie/fonctionnalites/alertes/#sur-le-téléphone).

## SMS et RCS

Un numéro de **Administration › Numéros SMS** ne porte pas le secret de son compte : il nomme
la variable qui le contient, comme un outil de l’IA. Le nom est libre — la démonstration dit
`TWILIO_AUTH_TOKEN` — et la variable se définit à côté des autres. Sans elle, le numéro refuse
ce qui arrive et ne répond pas. Voir [SMS et RCS](/messagerie/fonctionnalites/sms-et-rcs/).

| Variable | Défaut | Rôle |
|---|---|---|
| le nom que donne le numéro | — | Twilio : l’**Auth Token** du compte, qui vérifie la signature de chaque appel de Twilio et signe les envois. SMS Mode : la **clé d’API**, envoyée dans `X-Api-Key` |

## Webhooks

| Variable | Défaut | Rôle |
|---|---|---|
| `CHAT_WEBHOOK_ALLOW` | — | des destinataires du réseau interne, séparés par des virgules : un nom (`crm.interne.example`), un domaine et ses sous-domaines (`*.interne.example`), une plage (`10.20.0.0/16`). Sans elle, un webhook n’appelle qu’une adresse publique, en HTTPS sur le port 443 |
| `CHAT_WEBHOOK_DEV` | — | `1` : HTTP et adresses locales permis, pour essayer un récepteur sur sa machine. À réserver au développement |

Elles valent aussi pour l’étape **Appeler une adresse** des
[automatisations](/messagerie/fonctionnalites/automatisations/#appeler-une-adresse). Voir
[Webhooks](/messagerie/integrations/webhooks/).

## Les secrets des outils de l’IA

Un outil de l’IA ou un serveur MCP déclaré dans **Administration › Outils IA** ne porte jamais
son secret : il nomme une variable d’environnement du serveur, `${METEO_TOKEN}` dans un en-tête
par exemple. Le nom est libre ; la variable se définit à côté des autres (`outils.env` avec
Docker Compose). Un en-tête dont la variable manque n’est pas envoyé. Voir
[Outils de l’IA](/messagerie/fonctionnalites/outils-ia/).

## Développement seulement

| Variable | Défaut | Rôle |
|---|---|---|
| `CHAT_DEV_AGENT` | — | l’adresse e-mail d’un conseiller actif, au nom duquel le serveur répond aux requêtes de l’inbox sans session : pas de connexion sur un poste de développement. Le modèle `apps/server/.env.example` y met le superviseur de la démonstration, `marc.jamain@exemple.fr`. Ignorée en production |
| `CHAT_MCP_DEMO_PORT` | `8820` | le port du serveur MCP de démonstration (`mcp-demo`) |

Au premier démarrage sur une base vide, hors production, le serveur écrit le paramétrage de
démonstration (Acme Assurances) ; `corepack pnpm seed` vide le schéma `chat` et y ajoute les
conversations de démonstration.
