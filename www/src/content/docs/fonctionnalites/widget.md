---
title: Le widget
description: Le script à coller dans un site, ce qu’y voit le visiteur, et l’éditeur qui le règle avec son aperçu en direct.
---

Le widget est la partie que voient les visiteurs : un bouton dans le coin de la page, qui ouvre
une conversation avec l’agent IA ou avec un conseiller. C’est **un seul script**, servi par le
serveur de la Messagerie, sans feuille de style, sans police, sans dépendance de la page.

## Installer

Une balise, sur chaque page du site, avant la fin de `<body>` :

```html
<script src="https://chat.exemple.fr/widget.js" data-site="<identifiant du site>" async></script>
```

L’onglet **Installation** de l’éditeur du widget (**Administration › Widget**) la donne toute
faite, avec l’adresse du serveur et l’identifiant du site : il n’y a qu’à la copier.

| Attribut | Rôle |
|---|---|
| `data-site` | **Obligatoire.** L’identifiant du site, celui de sa ligne dans **Administration › Sites et horaires**. Sans lui, le widget ne s’affiche pas et la console le dit. |
| `data-identity` | L’identité d’un client connecté au site, signée par son serveur. Voir [Identité signée](/messagerie/integrations/identite-signee/). |
| `data-api` | L’adresse du serveur de la Messagerie, quand ce n’est pas celui qui a servi le script. Par défaut, le widget parle au serveur d’où vient `widget.js`. |

Une seule balise par page : le widget ne s’installe qu’une fois, et une seconde balise
priverait la page de ses commandes. La page le pilote
ensuite par `window.MessagerieChat` — ouvrir, préremplir, dire qui est le visiteur, joindre des
données — : voir l’[API JavaScript](/messagerie/integrations/api-javascript/). Elle peut aussi
déclarer ce qu’elle sait faire, pour que l’IA le lui demande : voir les
[actions de la page](/messagerie/integrations/actions-de-page/).

## Domaines autorisés

Un site nomme les domaines où son widget a le droit de s’afficher : **Administration › Sites et
horaires**, onglet **Sites**, champ **Domaines autorisés**. L’onglet **Installation** de
l’éditeur du widget les rappelle, avec un lien pour les modifier.

- Un domaine vaut pour lui seul : `www.exemple.fr` n’ouvre pas `exemple.fr`. Écrivez les deux
  s’il le faut.
- `*.exemple.fr` vaut pour tous les sous-domaines — mais pas pour `exemple.fr` lui-même.
- Le protocole, le chemin et le port sont ignorés : seul compte le nom d’hôte.
- Sans domaine, le widget ne s’affiche nulle part. Un site dont la case **Actif** est décochée
  non plus.

Chaque appel du widget est vérifié contre l’origine de la page. Sur une page qui n’est pas
autorisée, le widget n’affiche rien, et la console du navigateur dit pourquoi
(`Messagerie : ORIGIN_NOT_ALLOWED`).

## Ce que voit le visiteur

### Le bouton, et la bulle d’accueil

Un bouton rond, ou une pastille avec un libellé (« Une question ? »), dans le coin choisi. Quand
le panneau est fermé, un nouveau message s’annonce à côté du bouton — son auteur et ses premiers
mots — et le bouton porte le nombre de messages non lus.

La **bulle d’accueil**, si le site l’a activée, montre le message d’accueil à côté du bouton
quelques secondes après l’arrivée sur la page, sans ouvrir le widget. Elle ne paraît qu’une fois
par visite, et seulement à un visiteur qui n’a pas encore écrit.

### L’accueil

À l’ouverture, avant que le visiteur écrive :

- le nom du site, son logo s’il en a un, et les initiales de trois conseillers actifs — les
  personnes derrière l’IA — si le site les montre ;
- un titre (« Comment pouvons-nous vous aider ? » par défaut, « Bonjour Sophie » pour un client
  connecté) et un sous-titre, qui dit par défaut qui répond : l’assistant IA, ou les conseillers ;
- le **message d’accueil**, premier message du fil ;
- les **questions suggérées**, six au plus : un clic envoie la question.

Dès le premier message, l’en-tête se réduit à une ligne, avec l’état de la conversation :
« L’assistant répond tout de suite », « Un conseiller vous répond », « Conseillers de retour
lundi à 09:00 »…

### Le fil

- **Les réponses de l’IA sont présentées comme telles** : signées « Assistant », avec une
  pastille « IA » dont l’infobulle dit « Réponse générée par une IA ».
- Un conseiller n’est nommé que par son prénom.
- Les étapes de la conversation s’y lisent : « Un conseiller va reprendre votre demande » quand
  l’IA transfère, « Camille a rejoint la conversation », « Conversation terminée ». Les notes et
  les événements internes de l’équipe n’y paraissent jamais.
- **« Quelqu’un écrit »** : trois points, avec l’avatar de l’IA ou celui du conseiller qui
  écrit. Ce que le conseiller tape ne quitte pas son navigateur ; seul le signal part.
- Les réponses de l’équipe et de l’IA s’affichent avec leur mise en forme — gras, italique,
  listes, citations, liens — sans qu’un message puisse jamais devenir du code dans la page.
- Un message supprimé par un conseiller laisse « Ce message a été supprimé ».

### Laissez-nous votre e-mail

Quand personne ne peut répondre tout de suite, le fil montre une carte : « Personne ne peut
vous répondre tout de suite. Laissez votre e-mail : nous vous répondrons dès que possible. »
Le visiteur y tape son adresse, puis **Envoyer** ; la carte le remercie : « Merci ! Nous vous
répondrons à … » L’adresse va sur son contact, et le fil des conseillers le dit.

La carte paraît dans deux cas :

- l’IA passe la main alors que le site est fermé ;
- une automatisation le demande, par l’étape **Demander l’e-mail du visiteur** — avec son propre
  texte, si elle en a un. Celle qui est là dès le départ, **Demander l’e-mail quand la réponse
  tarde**, le fait après cinq minutes sans réponse (voir
  [Automatisations](/messagerie/fonctionnalites/automatisations/#demander-le-mail-du-visiteur)).

Elle ne paraît qu’une fois par conversation, et jamais pour un contact dont l’adresse est déjà
connue. Un client que le site a signé garde l’adresse de sa signature.

### Ce que l’IA propose de faire sur la page

Quand la page a déclaré des [actions](/messagerie/integrations/actions-de-page/) et qu’un
superviseur les a autorisées, l’IA peut les demander. Une action qui change la page s’affiche
d’abord dans le fil — « L’assistant propose : Pré-remplir le devis auto », avec ses valeurs —,
et ne s’exécute que si le visiteur choisit **Accepter** ; **Non merci** la refuse. Une ligne
garde ensuite ce qu’il en est : fait, refusé, ou n’a pas pu être fait.

### Fichiers et emoji

Le visiteur joint des fichiers (trombone, glisser-déposer, image collée) et choisit parmi une
cinquantaine d’emoji, que le système dessine : voir [Pièces jointes](/messagerie/fonctionnalites/pieces-jointes/).
Entrée envoie, Maj+Entrée va à la ligne, Échap ferme le panneau.

### D’une page à l’autre

Le widget garde, dans le navigateur, un jeton qui ramène le visiteur à sa conversation, d’une
page et d’une visite à l’autre. Le panneau resté ouvert le reste en changeant de page. Une
conversation résolue depuis plus d’un jour est terminée : le message suivant en ouvre une
nouvelle.

Une fois la conversation commencée, le widget dit aux conseillers la page que le visiteur
ouvre, et celles qu’il parcourt ensuite : son adresse et son titre, sans rien de ce qui suit
`#` ni les paramètres qui ressemblent à un secret. Ils les lisent dans le panneau de détails
(voir [l’inbox](/messagerie/fonctionnalites/inbox/#le-panneau-de-détails)).

Sur un écran de 480 pixels de large ou moins, le panneau occupe tout l’écran.

### La langue

Le site choisit la langue du widget (**Langue du widget** : français, anglais, allemand,
espagnol), qui règle aussi l’écriture des heures et des jours. Aujourd’hui, les textes du widget
sont traduits en anglais ; en allemand et en espagnol, ils restent en français. Le titre, le
message d’accueil et les questions suggérées sont ceux que le site a écrits.

## Horaires

Les horaires d’ouverture et les fermetures exceptionnelles se règlent dans **Administration ›
Sites et horaires**, onglets **Horaires** et **Fermetures**, à l’heure du **Fuseau horaire** du
site. Ils changent ce que dit le widget :

- hors des horaires, l’en-tête annonce le retour des conseillers (« Conseillers de retour demain
  à 09:00 »), ou « Conseillers absents pour le moment » ;
- pendant une fermeture qui porte un **Message aux visiteurs**, ce message s’affiche en tête du
  fil ;
- l’IA, quand le site l’a, répond à toute heure.

Le réglage **Masquer quand personne ne répond** retire le widget hors des horaires, sur un site
sans IA — sauf pour un visiteur qui a déjà une conversation en cours.

## L’éditeur du widget

**Administration › Widget** règle l’apparence et les textes du widget, site par site, à côté du
vrai widget qui tourne en aperçu, en cinq onglets : **Apparence**, **Textes**, **Affichage**,
**Installation** et **Actions**. Les réglages sont ceux de la ligne du site, dans le
paramétrage de la Messagerie : l’éditeur les lit, et seul un superviseur les enregistre.

### Apparence

| Réglage | Ce qu’il change |
|---|---|
| **Couleur** | Le bouton, le bandeau et les messages du visiteur. Neuf teintes proposées, ou n’importe quelle couleur. Le texte posé dessus passe seul au blanc ou au noir ; sous un contraste de 4,5:1, l’éditeur prévient. |
| **Thème** | **Automatique** (celui du système du visiteur), **Clair** ou **Sombre**. |
| **Coins** | **Arrondis**, **Adoucis** ou **Droits**. |
| **Police** | **Du site** : celle du texte de la page. **Système**, **Arrondie**, **Serif** : la police de l’appareil qui s’en approche. **Autre** : le nom d’une police que le site charge déjà, par exemple Inter. |
| **Logo** | L’adresse https d’une image carrée, en tête du widget. |
| **Montrer l’équipe** | Les initiales des conseillers actifs, en tête du widget. |
| **Côté** | **En bas à gauche** ou **En bas à droite**. |
| **Marge latérale**, **Marge du bas** | La distance au bord de la page, de 0 à 200 pixels (20 par défaut). |
| **Bouton** | **Rond**, ou **Avec libellé** : une pastille qui porte un texte de 40 caractères au plus. |

### Textes

| Réglage | Ce qu’il change |
|---|---|
| **Nom affiché** | Le nom du site, en tête du widget. |
| **Langue du widget** | Voir [La langue](#la-langue). |
| **Titre d’accueil** | Le titre de l’accueil. `{prénom}` y devient le prénom d’un client connecté, et disparaît pour un visiteur anonyme : « Bonjour {prénom} ». |
| **Sous-titre** | La ligne dessous. Vide : une phrase qui dit qui répond, l’IA ou les conseillers. |
| **Message d’accueil** | Le premier message du fil. Le gras, les listes et les liens s’affichent. |
| **Questions suggérées** | Proposées d’un clic avant que le visiteur écrive, six au plus. |

### Affichage

| Réglage | Ce qu’il change |
|---|---|
| **Bulle d’accueil** | Le message d’accueil à côté du bouton, après un délai de 0 à 600 secondes (5 par défaut), une fois par visite. |
| **Masquer sur mobile** | Aucun widget sur un écran de moins de 480 pixels. |
| **Masquer quand personne ne répond** | Hors des horaires d’ouverture, sur un site sans IA, le widget ne s’affiche pas. |
| **Mention « Propulsé par Messagerie »** | La mention en pied du widget ; le nom mène au site de la Messagerie, dans un nouvel onglet. |

### Installation

L’onglet **Installation** donne la balise à coller, celle d’un client connecté, les domaines
autorisés du site et un aide-mémoire de l’API JavaScript.

### Actions

L’onglet **Actions** liste **Ce que les pages du site savent faire** : les actions qu’elles ont
déclarées avec `registerAction`. Chacune s’y autorise, et peut demander l’**Accord du visiteur
avant d’agir**. L’onglet rappelle aussi comment déclarer une action et dire où en est la page.
Voir [Actions de la page](/messagerie/integrations/actions-de-page/#autoriser-une-action).

### L’aperçu en direct

À droite des réglages, le vrai widget tourne sur une page esquissée en gris, pour être vu là où
il vivra, dans son coin. Chaque changement s’y voit aussitôt. Au-dessus, l’aperçu choisit :

- ce qu’il montre : **Fermé**, **Bulle d’accueil**, **Accueil** ou **Conversation** — une
  conversation d’exemple, avec une réponse de l’IA et l’arrivée d’un conseiller ;
- le visiteur : **Anonyme**, ou **Client connecté**, pour voir le titre avec son prénom ;
- l’écran : ordinateur ou mobile.

L’aperçu n’appelle jamais le serveur : un message tapé dedans reçoit une réponse d’exemple, un
fichier joint reste dans le navigateur, et aucune conversation n’est créée.

### Enregistrer

Les changements restent un brouillon jusqu’à **Enregistrer** ; **Annuler les modifications**
revient aux réglages enregistrés, et quitter la page avec un brouillon demande confirmation.
Une valeur impossible — une couleur mal écrite, un logo qui n’est pas en https, une marge hors
bornes — est signalée et empêche l’enregistrement.

Les mêmes vérifications valent quand le serveur relit la ligne du site : un nom de police qui
contient autre chose que des lettres, des chiffres, des espaces, des tirets et des soulignés, un
logo qui n’est pas en https ou une marge hors bornes y sont lus comme vides.

## Sous le capot

- **Un script d’une soixantaine de Ko** (une vingtaine une fois compressé), écrit en Preact,
  qui ne charge ni feuille de style, ni bibliothèque.
- **Un Shadow DOM** : les styles de la page n’atteignent pas le widget, et les siens n’atteignent
  rien de la page.
- **Aucune police chargée** sur le site du client : celle de la page, ou une police de
  l’appareil.
- **Un seul canal temps réel**, le WebSocket du serveur, qui se rétablit seul après une coupure.
- **Des limites contre les scripts** : 20 messages par minute et par visiteur — au-delà, le
  widget demande de patienter un instant —, et 30 ouvertures de session par minute et par
  adresse.
