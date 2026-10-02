---
title: Premiers pas
description: Créer le premier superviseur, inviter un conseiller, régler un site et son widget, puis voir une conversation arriver, l’IA répondre et un conseiller reprendre la main.
---

Ce parcours suppose la messagerie lancée sur votre machine, avec les données de démonstration
d’Acme Assurances (voir [Installation](/messagerie/guides/installation/)). Pour voir l’IA
répondre, il faut aussi une clé, `CHAT_AI_API_KEY`.

## 1. Créer le premier superviseur

Ouvrez l’inbox, http://localhost:3210. Au premier lancement, personne ne peut encore se
connecter : l’écran s’ouvre sur **Bienvenue dans la messagerie**. Entrez un **Nom**, une
**Adresse e-mail** et un **Mot de passe** — 10 caractères au moins, pas votre adresse —, deux
fois, puis **Créer le compte**. Vous voilà superviseur, et connecté.

Avec la démonstration, entrez l’adresse de son superviseur, `marc.jamain@exemple.fr` : son
compte devient le vôtre, avec ses équipes et ses conversations.

Les fois suivantes, l’écran demande l’**Adresse e-mail** et le **Mot de passe**, puis **Se
connecter**. Si le serveur connaît un fournisseur d’identité (OpenID Connect), un second bouton,
**Continuer avec …**, connecte par le compte de l’entreprise. Le menu du compte, au pied de la
barre latérale, propose **Changer mon mot de passe** et **Se déconnecter**.

:::note[Sans se connecter]
Avec `CHAT_DEV_AGENT=marc.jamain@exemple.fr` dans `apps/server/.env`, l’inbox s’ouvre
directement, au nom de ce conseiller. C’est réservé au développement : en production, une
requête sans session est refusée.
:::

## 2. Inviter un conseiller

Les autres comptes se créent depuis l’inbox. Ouvrez **Administration › Équipes et conseillers**,
onglet **Conseillers**, puis **Inviter un conseiller** : son **Nom**, son **Adresse e-mail**, son
**Rôle** (**Conseiller** ou **Superviseur**) et ses **Équipes**, puis **Inviter**.

Le compte est créé, et un **Lien à transmettre** s’affiche, avec **Copier**. Il ne s’affichera
plus, et vaut sept jours, une seule fois : envoyez-le maintenant, par le moyen de votre choix. La
personne qui l’ouvre choisit son mot de passe, puis **Rejoindre la messagerie** : elle est
connectée.

Pour l’essayer seul, ouvrez le lien dans une fenêtre de navigation privée : dans la même fenêtre,
la session du nouveau conseiller remplacerait la vôtre.

Un mot de passe oublié se remplace de la même façon : sur la fiche du conseiller, **Créer un
lien**. Voir [Conseillers et droits](/messagerie/fonctionnalites/conseillers-et-droits/).

## 3. Découvrir l’inbox

La barre latérale range ce qu’un conseiller utilise :

- **Conversations**, et sous elles chaque boîte de réception, avec ce qui y attend ;
- **Contacts**, **Connaissances** et **Statistiques** ;
- en bas, **Administration**, pour les superviseurs seuls ;
- tout en bas, le menu du compte : disponibilité, alertes, apparence.

La liste des conversations se filtre en un clic — **Toutes**, **IA**, **Ouvertes**, **Non
assignées** — et se cherche (`/` pour y aller, `#étiquette`, `@conseiller`). À droite, le fil de
la conversation choisie, puis le panneau du contact. **Ctrl+K** ouvre la palette : conversations,
contacts, mots des messages et commandes. Voir [L’inbox](/messagerie/fonctionnalites/inbox/).

## 4. Régler un site

Un site se règle sans quitter l’inbox. Ouvrez **Administration › Sites et horaires**, onglet
**Sites**, puis **Acme Assurances** :

- **Domaines autorisés** : un par ligne. Le widget ne s’affiche que sur les pages de ces
  domaines (`*.exemple.fr` pour tous ses sous-domaines). La démonstration autorise `localhost` et
  `127.0.0.1`.
- **L’agent IA** : **L’IA répond en premier**, ses **Consignes**, et son **Seuil de confiance** —
  en dessous, elle passe la main à un conseiller.
- Les onglets **Horaires** et **Fermetures** disent quand des conseillers répondent.

À droite, l’aperçu montre ce que le réglage change. Les changements restent des brouillons
jusqu’à **Enregistrer** (ou Ctrl+S). Voir [Le paramétrage](/messagerie/fonctionnalites/parametrage/).

## 5. Régler le widget

**Administration › Widget** ouvre l’éditeur du widget. À gauche, ses réglages en quatre
onglets — **Apparence**, **Textes**, **Affichage**, **Installation** ; à droite, le vrai widget,
en aperçu, qui suit chaque changement. Choisissez une couleur, un message d’accueil, des
questions suggérées, puis **Enregistrer**. Voir [Le widget](/messagerie/fonctionnalites/widget/).

## 6. Coller le script sur une page

L’onglet **Installation** donne la ligne à coller, avant la fin de la balise `body`, sur chaque
page du site :

```html
<script src="http://localhost:8810/widget.js" data-site="…" async></script>
```

`data-site` est l’identifiant du site ; l’éditeur le remplit pour vous. Rien d’autre à charger :
le script apporte tout, dans un Shadow DOM qui ne touche pas à la page.

Pour l’essayer, servez une page HTML depuis `localhost` — un domaine autorisé —, par exemple avec
`python -m http.server 8000` dans son dossier, puis ouvrez http://localhost:8000. Une page ouverte
directement depuis le disque (`file://`) n’a pas d’origine que le serveur puisse vérifier : le
widget y est refusé. La page http://localhost:8810/demo est prête à l’emploi.

## 7. Voir la conversation arriver

Ouvrez le widget sur la page et écrivez, en visiteur. Dans l’inbox, la conversation paraît dans
la liste à l’instant, sans recharger : le serveur signale chaque écriture par WebSocket. Tant que
l’IA répond, elle est sous le filtre **IA**, et aucun conseiller n’est appelé.

## 8. L’IA répond

L’IA répond à partir des articles publiés de la base de connaissance, et les cite. Dans le fil,
sa réponse est marquée **Réponse de l’IA**, avec sa **Confiance** et ses sources ; le visiteur,
lui, sait qu’il parle à une IA.

Quand elle n’est pas sûre d’elle — sous le seuil du site, ou sur un sujet qu’un garde-fou lui
interdit —, elle transfère la conversation à un conseiller, avec un **Résumé de l’IA**. Les
conseillers concernés sont alors prévenus : un son, une notification du bureau, la cloche. Voir
[L’agent IA](/messagerie/fonctionnalites/agent-ia/) et [Les alertes](/messagerie/fonctionnalites/alertes/).

Sous chaque réponse de l’IA, **Votre avis** : **Accepter**, **Modifier** ou **Rejeter**. Ces avis
forment le jeu d’évaluation de l’IA.

## 9. Reprendre la main

Un conseiller n’attend pas le transfert : **Reprendre la main**, en tête du fil, retire la
conversation à l’IA et la lui affecte. Répondre au visiteur a le même effet. Le fil le dit :
« … a repris la main : l’IA ne répond plus ici. »

Dans le composeur, **Demander au copilote** lui fait proposer des réponses ; **Reformuler avec
l’IA** reprend un brouillon ; et `/` insère une réponse type. **Note interne** écrit pour
l’équipe seulement. Une fois la question réglée, **Résoudre**. Voir
[Le copilote](/messagerie/fonctionnalites/copilote/).

## Et ensuite ?

- [La base de connaissance](/messagerie/fonctionnalites/base-de-connaissance/) : écrire et
  publier les articles où l’IA puise.
- [L’identité signée](/messagerie/integrations/identite-signee/) : reconnaître les clients
  connectés à votre site.
- [Mise en production](/messagerie/hebergement/production/) et
  [les comptes](/messagerie/hebergement/comptes/).
