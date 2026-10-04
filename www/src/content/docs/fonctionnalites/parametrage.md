---
title: Paramétrage
description: Les écrans où un superviseur règle la messagerie sans quitter l’inbox — boîtes, équipes, conseillers, sites, horaires, réponses types, étiquettes, garde-fous, outils de l’IA, automatisations, widget, numéros SMS, API — et dont les données vivent dans les tables du schéma chat.
---

Un superviseur règle la messagerie depuis l’inbox. Les écrans de paramétrage lisent et
écrivent les tables du paramétrage, dans le schéma `chat` de la base PostgreSQL de la
messagerie, à côté des conversations : rien d’autre à installer, rien à synchroniser (D1, D19).

## Où sont les écrans

Les écrans sont dans la section **Administration**, au pied de la barre latérale, que seuls les
superviseurs voient. Elle se replie ; barre latérale réduite, c’est un menu.

| Écran | Adresse | Tables du paramétrage |
|---|---|---|
| **Boîtes de réception** | `/parametrage/boites` | « Boîtes de réception » |
| **Équipes et conseillers** | `/parametrage/equipes` | « Équipes », « Conseillers » |
| **Sites et horaires** | `/parametrage/sites` | « Sites », « Horaires d'ouverture », « Fermetures exceptionnelles » |
| **Réponses types et étiquettes** | `/parametrage/reponses` | « Réponses types », « Étiquettes » |
| **Garde-fous** | `/parametrage/garde-fous` | « Garde-fous » |
| **Outils IA** | `/outils` | « Outils IA », « Serveurs MCP » |
| **Automatisations** | `/automatisations` | les automatisations et leurs exécutions (D20) |
| **Widget** | `/widget` | « Sites » : l’apparence et les textes du widget ; les actions que déclarent ses pages (D21) |
| **Numéros SMS** | `/parametrage/sms` | « Numéros SMS » (D23) |
| **Adresses e-mail** | `/parametrage/email` | « Adresses e-mail » (D24) |
| **API et MCP** | `/parametrage/api` | les jetons et les webhooks (D16, D17) |

La base de connaissance a son écran à part, dans la barre latérale de tous :
[**Connaissances**](/messagerie/fonctionnalites/base-de-connaissance/). Ses tables, « Articles »,
« Catégories » et « Conversations promues », s’y écrivent par les superviseurs de la même façon.

## Le kit Studio

Tous les écrans de la section, sauf **Automatisations**, **Widget** et **API et MCP**, sont
bâtis sur le même kit, celui de l’éditeur du widget :

- **à gauche, les lignes** de la table, avec un bouton pour en créer une — **Nouvelle boîte**,
  **Nouveau site**, **Nouvel outil** — et, au-delà de six lignes, **Rechercher…**. Une ligne
  désactivée est pâlie ;
- **au milieu, le formulaire** de la ligne choisie, rangé en sections, avec l’interrupteur
  **Actif** / **Désactivé** en tête quand la table a ce champ ;
- **à droite, l’aperçu** : ce que le réglage change, dessiné en direct à chaque frappe.

| Écran | Ce que montre l’aperçu |
|---|---|
| Boîtes de réception | la boîte **Dans le menu**, **Le chemin d’une conversation** — du site qui y verse aux conseillers qui la voient |
| Équipes | les boîtes où elle **Répond dans**, et ce que voit un conseiller **Au moment de transférer** |
| Conseillers | **Sa fiche**, **Ce qu’il voit**, **Sa charge** |
| Sites | le site **En une phrase**, **Qui répond, selon la confiance de l’IA**, **Sa semaine** |
| Horaires | **La semaine** d’ouverture, avec ses heures par semaine, et ce que dit le widget **Hors de ces heures** |
| Fermetures | **Au calendrier**, et ce que dit le widget **Ces jours-là** |
| Réponses types | la réponse **Dans le composeur**, après « / », puis **Chez le visiteur** |
| Étiquettes | l’étiquette **Sur une conversation**, et **Ce que lit l’IA** |
| Garde-fous | **Le moment venu** — le garde-fou qui se déclenche —, et **Ce que lit l’IA** |
| Outils | l’outil tel que l’IA le lit, et la requête qu’il envoie ([outils de l’IA](/messagerie/fonctionnalites/outils-ia/)) |
| Numéros SMS | **Dans Twilio** ou **Dans SMS Mode** — l’adresse à y donner, ce qui manque encore —, et **Sur le téléphone du client** ([SMS et RCS](/messagerie/fonctionnalites/sms-et-rcs/)) |

L’aperçu demande un écran large : sur un écran plus étroit, il n’est pas affiché.

### Des brouillons jusqu’à « Enregistrer »

Une modification reste un brouillon, ligne par ligne, jusqu’à **Enregistrer** — ou Ctrl+S. On
peut passer d’une ligne à l’autre sans rien perdre : un point orange marque, dans la liste,
chaque ligne modifiée ou nouvelle — **Modifié**, **Pas encore enregistré** au survol. **Annuler les modifications** rend à
une ligne ses valeurs ; **Abandonner** renonce à une ligne nouvelle.

Les brouillons ne vivent que dans la page ouverte : ils ne sont écrits nulle part avant
**Enregistrer**. **Enregistrer** reste grisé tant qu’un champ obligatoire est vide, et le dit
au survol : « À remplir : Nom ». Quitter la page avec des brouillons demande confirmation. Une
fois écrite, l’en-tête dit **Enregistré**.

### Supprimer une ligne

Au pied du formulaire, **Supprimer la boîte** (ou **Supprimer le site**, **Supprimer
l’outil**… selon l’écran) demande une confirmation : **Confirmer la suppression**. Dans la
liste, un clic droit sur une ligne offre aussi **Supprimer**, sans l’ouvrir, avec la même
confirmation. Tout superviseur peut supprimer une ligne ; la suppression est définitive.

Une liste vide, ou rien d’ouvert, montre une petite scène — la liste, une ligne sous le
curseur, le formulaire qu’elle ouvre et l’icône de la section —, et le bouton qui en crée une.

Une conversation garde l’identifiant de son site, de sa boîte et de son équipe, et le nom du
site au moment où elle a commencé : son historique survit à la ligne supprimée (D1).

Un conseiller, lui, n’est jamais supprimé : sur sa fiche, **Retirer le conseiller** le
désactive, et ses messages gardent son nom ([conseillers et droits](/messagerie/fonctionnalites/conseillers-et-droits/#désactiver-un-conseiller)).

### « Autres réglages »

Les champs d’une ligne sont ceux que déclare le modèle, `apps/server/src/settings/model.json` :
leurs libellés, leurs genres, leurs choix, leurs relations. Un champ que le modèle gagne — avec
sa colonne dans le schéma et sa place dans `settings/catalog.ts` —, et qu’un écran ne range pas
encore, paraît tout de même, sous **Autres réglages** — « Des champs du modèle que cet écran ne
range pas encore » —, avec un contrôle selon son genre et sa description. Le modèle reste la
référence (D10, D19).

### L’adresse

L’adresse suit l’écran, l’onglet et la ligne ouverte, en mots lisibles (D15) :
`/parametrage/sites/horaires/semaine-a9ce42ba3084`, `/parametrage/garde-fous/nouveau` pour une
ligne pas encore créée. Une adresse se partage avec un autre superviseur.

## Écrit dans les tables de la messagerie

Le serveur vérifie chaque valeur contre le modèle — son genre, ses choix, les champs
obligatoires —, puis l’écrit dans la table, par libellé de champ : `settings/catalog.ts` dit
quelle colonne, ou quelle table de liaison, porte chaque libellé (D19). Ainsi :

- **seul un superviseur écrit** : le serveur refuse toute écriture à un autre rôle, quel que
  soit le chemin ([conseillers et droits](/messagerie/fonctionnalites/conseillers-et-droits/)) ;
- **la messagerie suit aussitôt** : chaque écriture prévient, dans sa transaction, tous les
  processus de la messagerie — le serveur et, s’il y en a un, le worker —, qui oublient la
  table et la relisent à la demande suivante. Un changement d’article ou de conversation promue
  relance aussi l’indexation pour l’IA ;
- **pas d’historique** : une ligne garde sa dernière valeur, pas la suite de ses changements ni
  leur auteur. Les traces de l’IA, les messages et les événements des conversations, eux, sont
  gardés ([agent IA](/messagerie/fonctionnalites/agent-ia/#traçabilité)).

Un conseiller qui n’est pas superviseur ne voit pas la section **Administration**, et le
serveur lui refuse ces tables, en lecture comme en écriture. Il lit seulement les articles, les
catégories, les sites et les conversations promues. Sur un écran de paramétrage ouvert par son
adresse, il lit **Réservé aux superviseurs**.

:::note[Au premier lancement]
En production, le paramétrage commence vide : le premier superviseur, créé à la première
connexion, règle le reste ici ([installation](/messagerie/guides/installation/)). En
développement, au premier démarrage sur une base vide, le serveur écrit la démonstration —
Acme Assurances, son site, ses boîtes, ses équipes, ses articles (`settings/demo.json`).
:::

## Boîtes de réception

Une boîte dit **où arrivent** les conversations ; une équipe, **qui y répond** (D12).

- **La boîte** : son **Nom**, tel que le menu l’affiche, et sa **Description**.
- **Son apparence** : le bouton à gauche du nom — le sélecteur d’apparence, celui de basedb —
  choisit sa couleur, et un pictogramme de la bibliothèque Lucide ou une petite image
  (champs « Couleur », « Pictogramme », « Image »). Une image est réduite à 64 pixels.
- **Qui répond** : les **Équipes** dont les conseillers voient la boîte, et l’**Équipe par
  défaut**, à qui une nouvelle conversation est confiée ; aucune : l’équipe du site. Les
  superviseurs voient toutes les boîtes.

Une boîte désactivée ne reçoit plus rien.

## Équipes et conseillers

Deux onglets, **Équipes** et **Conseillers**.

- **Une équipe** : son **Nom**, sa **Description** — ce dont elle s’occupe, que les conseillers
  lisent en transférant —, et ses **Membres** ; un conseiller peut être de plusieurs équipes.
- **Un conseiller** : son **Nom** — son prénom s’affiche aux visiteurs, derrière l’IA —, son
  **Adresse e-mail**, celle de sa connexion, son **Rôle** (**Conseiller** : voit les boîtes de
  ses équipes, répond, transfère ; **Superviseur** : voit tout, réaffecte, et règle le
  paramétrage), ses **Équipes** et sa **Charge** — **Limiter les conversations simultanées**,
  au-delà desquelles plus aucune ne lui est confiée automatiquement.

La fiche d’un conseiller est aussi son compte (D4). **Inviter un conseiller** la crée et donne
un lien, affiché une fois, où la personne choisit son mot de passe ; **Créer un lien**, sur
une fiche, en donne un nouveau. Voir [conseillers et droits](/messagerie/fonctionnalites/conseillers-et-droits/).

## Sites et horaires

Trois onglets : **Sites**, **Horaires**, **Fermetures**.

### Sites

Un site, ou une marque, qui embarque le widget.

| Section | Réglages |
|---|---|
| **Le site** | **Nom**, affiché en tête du widget ; **Domaines autorisés** — le widget refuse de s’afficher ailleurs, `*.exemple.fr` vaut pour les sous-domaines ; **Langue du widget** ; **Fuseau horaire**, où se lisent les horaires |
| **Où arrivent ses conversations** | **Boîte de réception** (aucune : la première boîte active) ; **Équipe par défaut**, qui reçoit ce que l’IA transfère |
| **L’agent IA** | **L’IA répond en premier** ; **Seuil de confiance** ; **Consignes** — le ton, ce qu’elle doit toujours dire, ce qu’elle ne doit jamais promettre ([agent IA](/messagerie/fonctionnalites/agent-ia/)) |
| **Le visiteur parti** | **Répondre par e-mail** (activé) : les réponses qu’un visiteur n’a pas vues lui partent par e-mail s’il a laissé son adresse ([le widget](/messagerie/fonctionnalites/widget/#la-réponse-par-e-mail)) |
| **Conservation** | **Purger les conversations après** 1 mois, 3 mois, 6 mois, 1 an ou 2 ans — avec leurs pièces jointes et leurs extraits indexés pour l’IA |

Un nouveau site part en français, au fuseau `Europe/Paris`, avec l’IA en premier, un seuil de
70 % et une conservation d’un an.

La purge passe chaque nuit à 3 h, à l’heure du serveur : une conversation sans message depuis
plus longtemps que la durée de son site part avec ses messages, ses pièces jointes et ses
traces, puis les contacts qui n’ont plus de conversation. Elle tourne avec les tâches de fond
de l’IA, donc seulement quand un modèle est configuré ([détails](/messagerie/fonctionnalites/agent-ia/#sans-clé-dia)).

Le lien **Apparence et textes du widget** mène à l’écran **Widget**, où se règlent les autres
champs de la ligne ([widget](/messagerie/fonctionnalites/widget/)).

### Horaires

Un créneau : un **Nom** libre (« Semaine », « Samedi matin »), ses **Jours**, son
**Ouverture** et sa **Fermeture** (au format `09:00`), et **Pour quel site** — aucun : il vaut
pour tous. Sans créneau, personne n’est jamais là : l’IA répond seule et le dit.

### Fermetures

Les jours où personne ne répond, horaires ou pas : un **Motif** (« Noël »), **Du** et **Au**
(vide : un seul jour), le **Message aux visiteurs** que le widget affiche ces jours-là, et le
**Site** — aucun : tous les sites sont fermés.

## Réponses types et étiquettes

Deux onglets, **Réponses types** et **Étiquettes**.

- **Une réponse type** : un **Titre**, un **Raccourci** tapé après « / » dans le composeur,
  sans espace, et un **Contenu** qui peut citer le contact : `{prénom}`, `{nom}`, `{email}`,
  remplacés par ce que le site a signé du client.
- **Une étiquette** : un **Nom**, une **Couleur**, et **Qui la pose** — **L’IA peut la poser
  seule**, sinon seuls les conseillers la posent. **Quand l’appliquer** décrit les cas en une ou
  deux phrases : l’IA le lit pour étiqueter, les conseillers aussi ([copilote](/messagerie/fonctionnalites/copilote/#intention-étiquettes-sentiment-priorité)).

:::note
Le formulaire d’une réponse type a un champ **Équipes** (« Aucune : proposée à tous les
conseillers »). Aujourd’hui, le composeur propose toutes les réponses types à tous les
conseillers, quelles que soient leurs équipes.
:::

## Garde-fous, outils, automatisations, widget, numéros SMS, API

- **Garde-fous** : les sujets sur lesquels l’IA ne répond pas elle-même. Voir
  [agent IA › garde-fous](/messagerie/fonctionnalites/agent-ia/#les-garde-fous).
- **Outils IA** : les outils et les serveurs MCP de l’IA, avec leur essai. Voir
  [outils de l’IA](/messagerie/fonctionnalites/outils-ia/).
- **Automatisations** : un déclencheur, une condition et des étapes, dessinés en flux, avec
  leurs modèles et le journal de leurs exécutions. Voir
  [automatisations](/messagerie/fonctionnalites/automatisations/).
- **Widget** : l’éditeur du widget, avec le vrai widget en aperçu, et l’onglet **Actions**, où
  s’autorisent les actions que déclarent les pages du site. Voir
  [widget](/messagerie/fonctionnalites/widget/) et
  [actions de la page](/messagerie/integrations/actions-de-page/).
- **Numéros SMS** : les numéros Twilio ou SMS Mode où les clients écrivent par SMS ou RCS. Voir
  [SMS et RCS](/messagerie/fonctionnalites/sms-et-rcs/).
- **Adresses e-mail** : l’adresse de chaque site, lue en IMAP et servie en SMTP, où les clients
  écrivent par e-mail. Voir [E-mail](/messagerie/fonctionnalites/e-mail/).
- **API et MCP** : les jetons des programmes et des agents, onglet **Jetons**, et les
  webhooks, onglet **Webhooks**. Voir l’[API REST](/messagerie/integrations/api-rest/), le
  [serveur MCP](/messagerie/integrations/mcp/) et les [webhooks](/messagerie/integrations/webhooks/).
