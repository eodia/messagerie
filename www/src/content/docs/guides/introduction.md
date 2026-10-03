---
title: Introduction
description: Ce qu’est la Messagerie, pour qui, et ce que vous y trouverez.
---

La **Messagerie** (nom de travail) est une messagerie client libre : un widget de chat à
coller dans votre site, un **agent IA** qui répond en première ligne, et une **inbox** où les
conseillers reprennent la main, aidés d’un **copilote**. Un serveur, un PostgreSQL : tout le
reste se règle dans l’inbox.

## Trois parties, un serveur

| Partie | Pour qui | Ce que c’est |
|---|---|---|
| **Le widget** | les visiteurs d’un site | un script à coller dans la page, une bulle qui ouvre la conversation |
| **L’inbox** | les conseillers | une application web : boîtes de réception, conversations, contacts, base de connaissance, tableaux de bord |
| **L’administration** | les superviseurs | les écrans **Administration** de l’inbox : boîtes, équipes et conseillers, sites et horaires, widget, outils de l’IA, automatisations, API |

Derrière, **le serveur** de la messagerie porte l’API, le temps réel (WebSocket), l’IA et les
tâches de fond. Il crée et met à jour son schéma PostgreSQL à chaque démarrage.

## Tout dans un PostgreSQL

La messagerie ne dépend d’aucun autre logiciel que PostgreSQL (avec pgvector). Tout vit dans
son schéma, `chat` :

- **le paramétrage** : sites et domaines autorisés, horaires, fermetures, boîtes de réception,
  équipes, conseillers, réponses types, étiquettes, articles, garde-fous, outils de l’IA,
  serveurs MCP ;
- **les comptes** des conseillers : mots de passe, sessions, liens d’invitation, identités chez
  un fournisseur d’identité ;
- **le flux** : contacts, conversations, messages, traces de l’IA, vecteurs de la base de
  connaissance. Les fichiers joints, eux, sont rangés dans un dossier du serveur.

**Aucun secret dans le paramétrage.** La clé d’un fournisseur d’IA, le secret qui signe
l’identité des clients d’un site, le jeton d’une API qu’appelle un outil : tout cela reste dans
l’environnement du serveur. Un outil nomme la variable qui porte son secret, jamais sa valeur.

## Les comptes des conseillers

Les conseillers ont leur compte dans la messagerie. Au premier lancement, l’écran de connexion
crée le **premier superviseur** ; il invite ensuite les autres depuis l’inbox, par un lien où
chacun choisit son mot de passe. Une entreprise qui a un fournisseur d’identité — Microsoft
Entra, Google, Keycloak… — y ajoute la connexion par **OpenID Connect**. Voir
[les comptes](/messagerie/hebergement/comptes/) et
[Conseillers et droits](/messagerie/fonctionnalites/conseillers-et-droits/).

## Pour qui ?

- **Les équipes de relation client** qui veulent une IA qui répond vite, cite ses sources et
  passe la main dès qu’elle doute — et une inbox où rien ne leur échappe.
- **Les organisations qui hébergent elles-mêmes** leurs données : un PostgreSQL, la messagerie,
  et le fournisseur d’IA de leur choix — Mistral par défaut, ou tout serveur compatible OpenAI,
  local compris.
- **Les équipes techniques**, qui trouvent une API REST, un serveur MCP et des webhooks.

## Ce que vous y trouverez

- L’[inbox](/messagerie/fonctionnalites/inbox/) : boîtes de réception, conversations, transferts,
  filtres, recherche, palette de commandes (Ctrl+K).
- Le [widget](/messagerie/fonctionnalites/widget/), réglé site par site dans son éditeur, avec un
  aperçu en direct.
- L’[agent IA](/messagerie/fonctionnalites/agent-ia/), qui répond à partir de votre base de
  connaissance, avec un seuil de confiance, des garde-fous et un transfert résumé.
- Le [copilote](/messagerie/fonctionnalites/copilote/) des conseillers : suggestions,
  reformulation, relecture pendant la frappe.
- La [base de connaissance](/messagerie/fonctionnalites/base-de-connaissance/), rédigée dans
  l’inbox et publiée pour l’IA.
- Les [outils de l’IA](/messagerie/fonctionnalites/outils-ia/) : la fiche du visiteur, des appels
  HTTP, des rappels, des serveurs MCP.
- Les [pièces jointes](/messagerie/fonctionnalites/pieces-jointes/), que l’IA lit à la demande
  d’un conseiller.
- Les [contacts](/messagerie/fonctionnalites/contacts/), avec leur pays et leur heure locale.
- Les [alertes](/messagerie/fonctionnalites/alertes/) : son, notifications du bureau, cloche.
- Les [tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/) : des questions posées
  aux conversations, assistées ou en SQL, dessinées en nombres et en graphiques.
- Les [automatisations](/messagerie/fonctionnalites/automatisations/) : un déclencheur, une
  condition, des étapes — attribuer, étiqueter, répondre, prévenir, appeler un autre système.
- Le [paramétrage](/messagerie/fonctionnalites/parametrage/), et les
  [conseillers et leurs droits](/messagerie/fonctionnalites/conseillers-et-droits/).
- Pour les intégrations : l’[API JavaScript](/messagerie/integrations/api-javascript/) du widget,
  les [actions de la page](/messagerie/integrations/actions-de-page/) que l’IA demande, l’[identité signée](/messagerie/integrations/identite-signee/) des clients connectés,
  l’[API REST](/messagerie/integrations/api-rest/), le [serveur MCP](/messagerie/integrations/mcp/)
  et les [webhooks](/messagerie/integrations/webhooks/).

## Une sœur de basedb

La messagerie est née à côté de [basedb](https://eodia.github.io/basedb/), autre logiciel libre
d’Eodia, dont elle reprend l’interface : mêmes couleurs, mêmes composants, même densité, même
façon d’écrire l’adresse de chaque écran. Elle n’en a pas besoin pour fonctionner.

## État du projet

La Messagerie est en développement actif chez [Eodia](https://eodia.com/fr/). « Messagerie »
est un nom de travail. Le serveur, l’inbox, le widget, l’IA, les comptes, les automatisations, les
tableaux de bord, l’API, le serveur MCP et les webhooks fonctionnent ; le serveur est couvert par des tests unitaires et des tests
d’intégration sur un vrai PostgreSQL.

Les décisions qui commandent l’ensemble sont écrites dans le dépôt, dans
[`docs/architecture/00-decisions-structurantes.md`](https://github.com/eodia/messagerie/blob/main/docs/architecture/00-decisions-structurantes.md) ;
la page [Principes](/messagerie/architecture/principes/) les résume.

## Licence

Logiciel libre, distribué sous **GNU Affero General Public License v3.0 ou toute version
ultérieure** (`AGPL-3.0-or-later`). Qui modifie la messagerie et la propose à des utilisateurs à
travers un réseau leur doit le code source de sa version.

:::tip[Essayer]
Avec Docker, un `docker-compose.yml` et `docker compose up -d` lancent PostgreSQL et la
messagerie en deux minutes, sur votre machine : voir
[Essayer avec Docker](/messagerie/guides/installation/#essayer-avec-docker). Pour la
développer, le dépôt cloné lance tout depuis les sources, avec la démonstration d’Acme
Assurances.
:::
