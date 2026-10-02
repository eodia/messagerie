---
title: Principes
description: Les décisions qui commandent l’architecture de la messagerie, et leur raison.
---

La messagerie a été conçue à partir d’un chapitre de décisions, dans le dépôt :
[`docs/architecture/00-decisions-structurantes.md`](https://github.com/eodia/messagerie/blob/main/docs/architecture/00-decisions-structurantes.md).
Il fait autorité, et chaque décision y porte un numéro stable (D1, D4…), que le code cite. En
voici l’esprit.

## Un seul PostgreSQL, un seul schéma (D1)

Tout vit dans le schéma `chat` d’une instance PostgreSQL, que le serveur migre à chaque
démarrage :

- **le paramétrage** : sites, horaires, fermetures, boîtes de réception, équipes, conseillers,
  réponses types, étiquettes, catégories, articles, conversations promues, garde-fous, outils de
  l’IA, serveurs MCP ;
- **les comptes** : les conseillers, leurs sessions, les liens d’invitation, leurs identités chez
  un fournisseur OpenID Connect ;
- **le flux** : contacts, conversations, messages, traces de l’IA, vecteurs, pièces jointes,
  notifications, jetons, webhooks.

Une conversation garde l’identifiant de son site, de sa boîte et de son équipe, et le nom du
site au moment où elle a commencé : l’historique survit à une ligne supprimée.

## La messagerie tient tout elle-même (D19, qui remplace D2)

La messagerie s’est d’abord appuyée sur basedb pour tout ce qui se paramètre. Depuis le
2 octobre 2026, elle n’en dépend plus : deux produits à installer, un jeton à émettre, la
contrainte d’un même hôte pour partager une session — pour quatorze petites tables que les
écrans de l’inbox éditaient déjà. Et le flux, dans le schéma `chat`, restait hors de vue des
tableaux de bord de basedb.

Le paramétrage est donc fait de tables du schéma `chat`, avec leurs clés étrangères. Les écrans
parlent en libellés de champs, que le serveur rapporte à ses colonnes. Une écriture prévient
tous les processus de la messagerie (`NOTIFY`), qui oublient ce qu’ils savaient de la table.

## L’installation : un PostgreSQL, puis le premier superviseur (D3)

Le serveur crée et migre son schéma au démarrage. Au premier lancement, personne ne peut se
connecter : l’écran de connexion crée le premier superviseur, qui invite les autres et règle le
reste dans l’inbox. En développement, le premier démarrage sur une base vide écrit la
démonstration d’Acme Assurances.

## Les conseillers ont leur compte dans la messagerie (D4, D19)

Un conseiller est une ligne de « Conseillers » — sa fiche et son compte à la fois. Il se connecte
avec son adresse et son mot de passe, ou par le fournisseur d’identité de l’entreprise.

- **Inviter** se fait dans l’inbox : la fiche est créée, et un lien s’affiche une fois, valable
  sept jours, une seule fois ; la personne y choisit son mot de passe. Un mot de passe oublié se
  remplace par un lien de même sorte.
- **Le mot de passe** est gardé en scrypt ; dix caractères au moins, pas l’adresse.
- **La session** est un cookie `httpOnly` du serveur, dont la base ne garde que l’empreinte ;
  elle vit trente jours depuis son dernier usage. Chaque écriture de l’inbox porte un en-tête
  qu’une page d’un autre site ne peut pas envoyer. Conséquence : **l’inbox et le serveur
  partagent un site** (`app.exemple.fr` et `api.exemple.fr`, ou le même hôte).
- **Un fournisseur OpenID Connect** — Microsoft Entra, Google, Keycloak… — connecte le
  conseiller de la même adresse. Il ne crée personne : on invite d’abord.
- **Un conseiller cité par des messages n’est jamais supprimé** : retiré, il est désactivé.

## Les visiteurs ne sont pas des comptes, et les secrets restent hors du paramétrage (D5)

Un visiteur est anonyme jusqu’à ce que le site signe son identité. La clé de signature d’un
site ne va pas dans le paramétrage, que tout superviseur lit : le serveur la garde à part. Les
clés des fournisseurs d’IA restent dans l’environnement du serveur ; un outil y nomme la
variable qui porte son secret, jamais sa valeur.

## Un seul canal temps réel, sans Redis (D6)

Un seul serveur WebSocket sert le widget et l’inbox ; la diffusion entre processus passe par
`LISTEN/NOTIFY` de PostgreSQL. Le WebSocket ne transporte que des signaux, émis dans la
transaction de l’écriture : seulement si elle est validée. L’inbox relit ensuite par l’API — un
seul chemin vers la vérité.

## Tout en TypeScript ; l’IA derrière une interface (D7, D8)

De bout en bout en TypeScript : un seul environnement à héberger, des types partagés. L’IA vit
dans un paquet, derrière une interface unique : Mistral par défaut, tout serveur compatible
OpenAI sinon. Les appels lourds tournent dans les tâches de fond, jamais dans le processus du
WebSocket. Drizzle décrit le schéma `chat`, pg-boss porte les tâches : les deux ne demandent que
PostgreSQL.

## Chaque intervention de l’IA est tracée et dite (D9)

Chaque appel à l’IA laisse une trace : modèle, entrées, sortie, confiance, latence, coût. Chaque
avis d’un conseiller sur une réponse — acceptée, modifiée, rejetée — aussi : ensemble, ils
forment le jeu d’évaluation. Toute réponse de l’IA est présentée comme telle au visiteur, et l’IA
n’agit que par les outils déclarés.

## Le serveur ne rédige pas de phrases (D9 bis)

Ce que le serveur enregistre pour un humain est une donnée : un événement typé, un code de refus.
L’inbox le met en phrase, dans la langue du lecteur. Seuls les textes écrits par des personnes ou
par l’IA sont gardés tels quels.

## Les alertes : le serveur dit pourquoi, l’inbox décide pour qui (D9 ter)

Chaque écriture qui appelle un conseiller dit pourquoi — un visiteur a écrit, l’IA a transféré,
quelqu’un a confié la conversation — et écrit, dans la même transaction, la ligne de la cloche
de chaque conseiller concerné. L’inbox décide du son, de la notification et des pastilles.

## L’interface est celle de basedb, et l’administration est dans l’inbox (D10)

La messagerie reprend l’interface de basedb, son projet frère : mêmes tokens, mêmes composants,
mêmes règles d’écriture. Le widget fait exception : Preact dans un Shadow DOM, pour peser
quelques dizaines de Ko sur le site d’un client.

Un superviseur règle la messagerie sans la quitter : **Administration**, au pied de la barre
latérale — boîtes, équipes et conseillers, sites et horaires, réponses types, garde-fous, outils
de l’IA, automatisations, widget, API et MCP. Chaque écran montre les lignes à gauche, le formulaire au milieu, et à droite ce que
le réglage change, dessiné en direct. Les changements restent des brouillons jusqu’à
« Enregistrer ». Le serveur vérifie chaque valeur contre le modèle du paramétrage avant de
l’écrire.

## Licence AGPL-3.0-or-later (D11)

Qui modifie la messagerie et la propose à des utilisateurs à travers un réseau leur doit le
code source de sa version.

## Boîtes de réception et équipes (D12)

Une boîte de réception dit où arrivent les conversations ; une équipe, qui y répond. Un
conseiller voit les boîtes que ses équipes servent ; un superviseur, toutes.

## Ce que la page peut dire au widget (D13)

Une page peut joindre des métadonnées au contact ou à la conversation. Rien n’en est vérifié :
l’inbox le dit, et l’IA les reçoit comme des données déclarées, jamais comme une preuve ni une
consigne. La page pilote le widget par `window.MessagerieChat`, et peut lui déclarer ses
actions (D21).

## Les pièces jointes, que l’IA lit sur demande (D14)

Le type d’un fichier se décide sur ses octets ; les octets vont dans un dossier du serveur,
jamais en base ; un fichier se lit par un lien signé. L’IA lit un fichier quand un conseiller le
demande, jamais parce qu’il est arrivé.

## L’adresse dit où l’on est (D15)

L’adresse suit l’écran, en mots lisibles et en français :
`/conversations/<boîte>/<conversation>`, `/contacts/<contact>`, `/parametrage/<groupe>/…`.

## Une API et un serveur MCP, des webhooks (D16, D17)

Une API REST et un serveur MCP ouvrent les conversations aux programmes et aux agents, avec des
jetons : lecture, ou lecture et écriture, jamais de suppression. Un jeton n’est pas un
conseiller : il écrit sous une ligne à lui, jamais active. Dans l’autre sens, des webhooks
signés préviennent un autre système de ce qui se passe ; chaque événement est capté par un
déclencheur, dans la transaction qui écrit, pour que rien ne se perde.

## Où est un contact : son fuseau horaire (D18)

Le pays et l’heure locale d’un contact viennent du fuseau horaire de son navigateur, pas de son
adresse IP : ni base GeoIP, ni service tiers.

## Les automatisations, celles de basedb faites pour les conversations (D20)

Une automatisation part d’un déclencheur, retient les conversations qui remplissent sa
condition, et enchaîne des étapes, dessinées en flux comme dans basedb. Le moteur lit les
événements que captent déjà les déclencheurs de la base pour les webhooks, et mène les
exécutions étape par étape, à plusieurs processus s’il le faut. Chaque automatisation agit sous
sa propre ligne de conseiller, jamais active : le fil dit qui a fait quoi. Pas de boucle : une
automatisation ne se déclenche jamais sur ce que son exécution a fait, une chaîne s’arrête à
trois, cent exécutions par heure au plus. Une exécution interrompue échoue plutôt que de
recommencer : ses étapes ont peut-être déjà écrit. Voir
[Automatisations](/messagerie/fonctionnalites/automatisations/).

## Les actions de la page (D21)

La page qui accueille le widget déclare ce qu’elle sait faire — chercher, tarifer, remplir un
formulaire — et dit où elle en est. C’est la page qui calcule : un tarif ne se recopie pas dans
le serveur, l’IA le demande à la page. Un superviseur autorise chaque action ; ce qui change la
page attend l’accord du visiteur. Ce que dit la page est une donnée non vérifiée, jamais une
consigne, et l’IA ne dit jamais « c’est fait » sans un résultat `ok`. Voir
[Actions de la page](/messagerie/integrations/actions-de-page/).

## Les tableaux de bord, ceux de basedb faits pour les conversations (D22)

Des cartes sur une grille, chacune une question dessinée en nombre, tableau ou graphique. Elles
lisent les vues du schéma `analytics`, jamais les tables elles-mêmes. Une question assistée est
compilée en SQL paramétré ; une question en SQL est un seul `SELECT`, en lecture seule, quinze
secondes au plus, sous un rôle qui ne lit que ces vues — ni comptes, ni sessions, ni secrets.
Les superviseurs font les tableaux ; un conseiller ne fait qu’exécuter une carte telle
qu’enregistrée, et n’envoie jamais de SQL. Voir
[Tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/).
