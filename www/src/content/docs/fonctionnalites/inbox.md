---
title: L’inbox des conseillers
description: Les boîtes de réception, la liste des conversations et ses filtres, le fil, le composeur, et tout ce qu’un conseiller fait d’une conversation.
---

L’inbox est l’écran où travaillent les conseillers. Trois volets côte à côte : la **liste des
conversations** à gauche, le **fil** de celle qui est ouverte au milieu, et le **panneau de
détails** à droite. Tout arrive en direct : un message, une affectation, un transfert font
bouger la liste sans la recharger. Si la connexion tombe, une pastille **Reconnexion…** le dit,
et la liste est relue dès le retour : rien n’est perdu entre-temps.

## La barre latérale

De haut en bas :

- le **menu des sites**, sous le nom de la Messagerie ;
- **Conversations**, puis une ligne par boîte de réception, chacune avec son compteur ;
- **Contacts**, **Connaissances**, **Tableaux de bord** ;
- **Administration**, repliée, pour les superviseurs seuls (voir
  [Paramétrage](/messagerie/fonctionnalites/parametrage/)) ;
- le menu du compte, en bas : **Disponibilité**, **Alertes**, **Mode audio**, **Apparence**,
  **Changer mon mot de passe** et **Se déconnecter**.

Le bouton en haut à gauche de chaque écran **replie la barre latérale** à ses seuls
pictogrammes ; le navigateur s’en souvient.

### Boîtes de réception

Une **boîte de réception** dit où arrivent les conversations, une **équipe** qui y répond
(D12). Chaque boîte a sa couleur et son pictogramme, que l’on retrouve sur l’avatar de chaque
conversation de la liste. **Conversations** montre toutes les boîtes ; une boîte choisie
restreint la liste à ses conversations. Un conseiller ne voit que les boîtes que sert l’une de
ses équipes ; un superviseur les voit toutes (voir
[Conseillers et droits](/messagerie/fonctionnalites/conseillers-et-droits/)).

### Le menu des sites

En haut de la barre latérale, le menu des sites restreint l’inbox à un site : ses conversations
et leurs compteurs, ses contacts, ses articles (et ceux qui valent pour tous les sites). Les
[tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/), eux, comptent tous les sites.
Il propose les sites dont on voit des conversations ; avec un seul site, il se contente de le
nommer.

C’est une **vue, pas un droit** : le choix est gardé par le navigateur, l’adresse ne le porte
pas. Chaque site y montre ce qui vous attend, et un point sur le menu signale qu’un autre site
que celui choisi a quelque chose pour vous. Ouvrir une conversation d’un autre site — depuis
la cloche ou une adresse — revient à **Tous les sites**.

## La liste des conversations

Au-dessus de la liste, quatre onglets, chacun avec son compte :

| Onglet | Ce qu’il montre |
|---|---|
| **Toutes** | les conversations actives : ni résolues, ni en attente |
| **IA** | celles auxquelles l’agent IA répond |
| **Ouvertes** | celles que les conseillers traitent |
| **En file** | les ouvertes que personne n’a encore prises |

Chaque ligne montre le contact (avec un badge quand le site l’a identifié), l’heure du dernier
message, ce qui a été dit en dernier et par qui — **Vous :**, le prénom d’un collègue, une
étincelle pour l’IA, un trombone pour des fichiers —, ou **En train d’écrire…** quand le
visiteur tape. Dessous, des pastilles : l’état, la priorité quand elle est haute ou urgente,
un sentiment négatif, la première étiquette, et l’avatar du conseiller qui l’a. Un point vert
marque une conversation non lue.

Quand le visiteur a parlé en dernier et qu’un conseiller doit lui répondre, une pastille dit
**depuis combien de temps il attend** : grise d’abord, ambre à 5 minutes, rouge à 30.

Les conversations sont rangées par jour — **Aujourd’hui**, **Hier**, **Cette semaine**,
**Plus ancien** —, la plus récente en tête.

### Filtres et tri

Le bouton **Filtres et tri**, à droite de la recherche, ouvre tous les filtres :

- **Trier par** : **Récentes**, **Attente** (le visiteur qui attend depuis le plus longtemps
  d’abord), **Priorité** ;
- **État** : **Actives**, **IA**, **Ouvertes**, **En file**, **En attente**, **Résolues** —
  les deux derniers n’ont pas d’onglet ;
- **Affectée à** : **Moi**, **Personne**, ou un conseiller ;
- **Étiquettes** : une ou plusieurs, avec **Au moins une** ou **Toutes** ;
- **Priorité** : **Urgente**, **Haute**, **Normale**, **Basse** ;
- **Sentiment** : **Négatif**, **Neutre**, **Positif** ;
- **Équipe**, et **Site** quand la liste en mêle plusieurs ;
- **Le visiteur attend une réponse** : **5 min et plus**, **30 min et plus** ;
- **Non lues seulement**, **Clients identifiés seulement**.

Les filtres actifs s’alignent sous les onglets, chacun avec sa croix ; **Effacer les filtres**
les retire tous, le tri reste. Ils sont gardés par le navigateur : un conseiller qui suit
l’étiquette « Sinistre » la retrouve le lendemain.

### Rechercher dans la liste

<kbd>/</kbd>, n’importe où hors d’un champ, place le curseur dans **Rechercher une
conversation…**. La recherche trouve un nom, une adresse e-mail, des mots d’un message, sans
tenir compte des accents ni des majuscules, et pardonne une faute de frappe. Deux préfixes la
resserrent :

- `#sinistre` : les conversations qui portent cette étiquette ;
- `@julie` : celles qu’a ce conseiller ; `@moi`, les vôtres.

Elle cherche dans tous les onglets, résolues comprises, mais **dans la boîte et les filtres
choisis**. Dès trois lettres, le serveur cherche aussi dans tous les messages : ce qu’il trouve
paraît sous **Dans les messages**, avec le passage qui répond. <kbd>↑</kbd> <kbd>↓</kbd> et
<kbd>Entrée</kbd> ouvrent un résultat ; <kbd>Échap</kbd> vide la recherche, puis la quitte.

### Plusieurs conversations à la fois

Au survol d’une conversation, une case remplace son avatar. Cochée, elle reste visible sur
toutes les lignes, et une barre prend la place des onglets :

- <kbd>Maj</kbd>+clic, sur une case ou sur une ligne, coche toutes les conversations depuis la
  dernière cochée ; <kbd>Ctrl</kbd>+clic (<kbd>⌘</kbd> sur Mac) sur une ligne la coche sans
  l’ouvrir ;
- la case de la barre coche toute la liste affichée — la boîte, l’onglet, les filtres et la
  recherche choisis —, ou la décoche ;
- <kbd>Échap</kbd>, la croix de la barre, ou un changement de boîte, d’onglet ou de site
  décochent tout.

La barre agit sur toutes les conversations cochées :

| Bouton | Effet |
|---|---|
| **Résoudre** | les résout |
| **Attribuer** | les donne à un conseiller, cherché comme dans [Affecter](#affecter), ou les remet dans la file |
| **Étiqueter** | leur pose une étiquette de la liste, ou une nouvelle |
| **Transférer** | les envoie dans une autre boîte, à une autre équipe, avec une note — comme [Transférer](#transférer) |
| **Mettre en attente** | les sort de la file jusqu’à une heure choisie |
| **Marquer comme lues** | les marque comme lues |

Chacune passe comme si on l’avait traitée seule : son fil garde l’événement, et ceux qu’il faut
prévenir le sont. Une conversation qui ne peut pas suivre est laissée telle quelle, et le
bandeau le dit : « 1 conversation mise en attente — 1 refusée : une conversation que l’IA
tient, ou déjà résolue, ne se met pas en attente. » Cent conversations au plus à la fois.

## Le fil

En tête, le contact : son nom, **Identifié** ou **Anonyme**, l’état de la conversation, puis
sa boîte et son équipe. Quand le panneau de détails est fermé, l’en-tête dit aussi son adresse,
le numéro de contrat que le site a transmis, et où il se trouve.

Le fil range les messages par jour. On y lit :

- les messages du visiteur, à gauche ;
- les réponses des conseillers, à droite, signées ;
- les **réponses de l’IA**, avec leur confiance, leurs sources et les boutons **Accepter**,
  **Modifier**, **Rejeter** (voir [L’agent IA](/messagerie/fonctionnalites/agent-ia/)) ;
- la carte **Transférée à un conseiller** quand l’IA passe la main : motif, résumé, confiance,
  équipe ;
- les **notes internes**, sur fond jaune, que le visiteur ne voit jamais ;
- les événements, sur une ligne : qui a repris la main, affecté, transféré, résolu, rouvert,
  mis en attente, quel outil l’IA a utilisé, ce qu’elle a demandé à la page du visiteur
  ([actions de la page](/messagerie/integrations/actions-de-page/#dans-linbox)), quand le widget
  a proposé au visiteur de laisser son e-mail et l’adresse qu’il a laissée, ce qu’une
  automatisation a fait — sous son nom.

Trois points disent quand le visiteur écrit, ou quand l’IA rédige. Le fil reste collé au
dernier message tant qu’on ne remonte pas le lire.

### Les actions de la conversation

À droite de l’en-tête :

| Bouton | Effet |
|---|---|
| **Reprendre la main** | quand l’IA répond : elle s’arrête, la conversation vous est affectée |
| **Résoudre** | la conversation passe dans **Résolues** |
| **Mettre en attente** | elle quitte la file jusqu’à une heure choisie |
| **Réveiller** | la sort de l’attente avant l’heure |
| **Affecter à un conseiller** | la confie à quelqu’un, ou la remet dans la file |
| **Transférer à une autre boîte ou une autre équipe** | voir plus bas |
| **Plus d’actions** | **Affecter à…**, **Remettre dans la file**, **Transférer…**, **Promouvoir en source pour l’IA**, et sous **Automatisations** celles qu’un conseiller lance d’un clic ([automatisations](/messagerie/fonctionnalites/automatisations/)) |
| **Afficher le panneau** | le panneau de détails, à droite |

Quand le fil est étroit, les boutons gardent leur pictogramme et disent leur nom au survol.

**Reprendre la main** n’est pas le seul moyen d’arrêter l’IA : un conseiller qui écrit au
visiteur pendant qu’elle répond prend la conversation, comme celui qui répond à une
conversation de la file. Une note interne, elle, ne prend rien.

**Résoudre et rouvrir.** Une conversation résolue se rouvre d’elle-même. Un conseiller qui y
répond la rouvre, et le fil le dit. Un visiteur qui écrit de nouveau la rend à son conseiller,
ou à l’IA si personne ne l’avait. **Promouvoir en source pour l’IA**, réservé aux
conversations résolues, l’envoie à la relecture, dans **Connaissances › Conversations
promues** (voir [Base de connaissance](/messagerie/fonctionnalites/base-de-connaissance/)).

**Mettre en attente.** Pour une conversation ouverte : **Dans 3 heures**, **Demain matin**,
**Lundi matin**, **Dans une semaine** (le matin, c’est 9 heures), ou **Choisir une date…**,
d’une minute à un an. Elle quitte la file et reste à son conseiller. Elle revient à l’heure
dite, non lue, et son conseiller en est prévenu — ou plus tôt, si le visiteur écrit.

### Affecter

Le sélecteur s’ouvre depuis l’en-tête, le menu **Plus d’actions** ou la ligne **Affectée à** du
panneau. On y tape un nom ou une adresse. Vous en tête, puis les membres de l’équipe de la
conversation, puis les autres ; chacun avec ce qu’il a **en cours** (en ambre à partir de cinq),
ou **libre**. <kbd>↑</kbd> <kbd>↓</kbd> et <kbd>Entrée</kbd> choisissent ; **Remettre dans la
file** la rend à l’équipe.

Confiée à quelqu’un, la conversation quitte l’IA. Celui qui la reçoit en est prévenu, sauf
s’il se l’est donnée lui-même.

### Transférer

**Transférer la conversation** la passe à une autre boîte, à une autre équipe de sa boîte, ou
les deux. Choisir une boîte propose son équipe par défaut ; **Note pour l’équipe**, facultative,
dit ce qu’il faut savoir pour reprendre, et s’écrit dans le fil en note interne.

La conversation revient dans la file de l’équipe choisie, dont les membres sont prévenus. Elle
quitte la personne qui l’avait, et l’IA.

## Le composeur

Deux onglets : **Répondre** écrit au visiteur ; **Note interne** écrit pour l’équipe seule, sur
fond jaune. Le brouillon de chaque conversation est gardé quand on passe à une autre.

- <kbd>Entrée</kbd> envoie, <kbd>Maj</kbd>+<kbd>Entrée</kbd> va à la ligne. Dans une liste,
  <kbd>Entrée</kbd> commence l’élément suivant, et <kbd>Ctrl</kbd>+<kbd>Entrée</kbd> envoie.
- La flèche à côté d’**Envoyer** propose **Envoyer et résoudre**.
- Pendant que vous écrivez une réponse, le visiteur voit trois points et votre prénom.

Au-dessus du champ, le copilote propose ses suggestions ; un clic en met une dans le champ, où
on la relit avant de l’envoyer (voir [Le copilote](/messagerie/fonctionnalites/copilote/)).

### Réponse enrichie

La barre sous le champ met en forme : **Gras** (<kbd>Ctrl</kbd>+<kbd>B</kbd>), **Italique**
(<kbd>Ctrl</kbd>+<kbd>I</kbd>), **Souligné** (<kbd>Ctrl</kbd>+<kbd>U</kbd>), **Couleur du
texte** (six couleurs), et sous **Plus de mise en forme** : **Barré**, **Code**, **Citation**,
**Liste à puces**, **Liste numérotée**, **Lien…**. Le widget affiche la réponse telle qu’elle
a été mise en forme.

### Relecture par l’IA

Après une pause dans la frappe, l’IA relit le brouillon et propose ses corrections dans le
texte même : le mot à changer barré en rouge, le bon en vert à côté. Un clic sur le vert
l’accepte ; à côté d’**Envoyer**, **Tout accepter** ou **Ignorer**. Taper autre chose les
oublie, et la relecture reprend à la pause suivante.

Le bouton **Reformuler avec l’IA** (la baguette) propose aussi **Plus clair**, **Plus court**,
**Plus chaleureux**, **Relire l’orthographe maintenant**, et la case **Relire après chaque
pause**, qui coupe la relecture automatique — un choix gardé par le navigateur. Sans IA
configurée sur le serveur, le brouillon n’est pas relu.

### Réponses types

Tapez <kbd>/</kbd> dans une réponse : les réponses types s’affichent, filtrées par leur
raccourci ou leur titre au fil de la frappe (`/resil`). <kbd>↑</kbd> <kbd>↓</kbd>, puis
<kbd>Entrée</kbd> ou <kbd>Tab</kbd>, l’insèrent ; <kbd>Échap</kbd> referme la liste.

Une réponse type peut contenir `{prénom}`, `{nom}` et `{email}`, remplacés par ceux du contact.
Le prénom et le nom ne sont remplis que pour un client identifié par son site : on ne nomme pas
un visiteur sur la foi de ce qu’il a tapé. Les réponses types se rédigent dans **Administration
› Réponses types et étiquettes**.

### Emoji, GIF et fichiers

- **Emoji** : cherchés par leur nom en français, avec leur teinte de peau, les derniers choisis
  en tête. Le système les dessine.
- **GIF** : le second onglet du même bouton cherche sur GIPHY. Un GIF choisi part avec le
  message, comme un fichier. Il faut une clé GIPHY au serveur (`GIPHY_API_KEY`, voir
  [Variables](/messagerie/hebergement/variables/)).
- **Fichiers** : le trombone, un glisser-déposer ou une image collée ; dix mégaoctets par
  fichier, cinq par message (voir [Pièces jointes](/messagerie/fonctionnalites/pieces-jointes/)).

### Mode audio : lecture et dictée

**Mode audio**, dans le menu du compte, fait lire les messages à voix haute : un haut-parleur
paraît au survol de chaque message du visiteur, réponse d’un conseiller ou réponse de l’IA, et
chaque nouveau message du visiteur, dans la conversation ouverte, est lu dès qu’il arrive. La
voix est celle de l’IA du serveur — Voxtral chez Mistral, réglée par `CHAT_AI_SPEECH_MODEL` et
`CHAT_AI_SPEECH_VOICE` — ou, à défaut, celle du navigateur.

Le micro du composeur, **Dicter**, écrit ce que vous dites, là où le navigateur sait
reconnaître la voix. Chrome et Edge la reconnaissent sur les serveurs de leur éditeur, ce que
le bouton rappelle. La dictée ne dépend pas du mode audio.

## Le panneau de détails

À droite du fil, quand l’écran est assez large. En tête, le contact : **Client identifié** ou
**Visiteur anonyme**, son adresse et son téléphone (copiés d’un clic), où il est et l’heure
qu’il y est, et trois cases — le nombre d’**Échanges**, le **Sentiment**, la **Priorité**. L’onglet
**Historique** liste ses autres conversations.

Dessous, des blocs que chacun range à sa guise :

- **Résumé de l’IA**, avec **Copier** ;
- **Conversation** : boîte, équipe, conseiller (un clic pour le changer), site, intention
  détectée par l’IA, et les étiquettes ;
- **Transmis par le site** : ce que la signature du site dit du client ;
- **Déclaré sur le contact** et **Données de la conversation** : les métadonnées ;
- **Outils IA** : les outils que le conseiller peut lancer (voir
  [Outils de l’IA](/messagerie/fonctionnalites/outils-ia/)).

Chaque bloc se replie. **Organiser le panneau** les fait glisser dans l’ordre voulu, ou les
masque ; **Réinitialiser** remet l’ordre de départ. Le navigateur s’en souvient.

### Étiquettes

**Ajouter une étiquette** ouvre **Chercher ou créer…** : les étiquettes déclarées dans
**Administration › Réponses types et étiquettes**, dans leur couleur, ou **Créer « … »** pour
un autre nom — en gris, sur cette conversation seulement. Celles que l’IA a posées le disent au survol. Une croix retire une
étiquette.

### Priorité et sentiment

La priorité (**Urgente**, **Haute**, **Normale**, **Basse**) et le sentiment du visiteur sont
estimés par l’IA en même temps que l’intention et les étiquettes. Ils servent à trier et à
filtrer la liste ; l’inbox n’offre pas de les changer à la main.

### Métadonnées

Ce que la page a joint au contact ou à la conversation — un numéro de commande, un panier —,
ou ce qu’un conseiller y a noté (D13). Des clés libres, aux valeurs courtes : texte, nombre, oui
ou non. **Ajouter une donnée** en écrit une, un clic sur une valeur la corrige, **Retirer**
l’efface.

:::caution[Rien n’en est vérifié]
Une métadonnée est une déclaration, pas une preuve : la page ou un conseiller l’a écrite. Seul
le bloc **Transmis par le site** vient d’une identité signée. L’IA reçoit les métadonnées comme
des données déclarées, jamais comme une consigne.
:::

## Supprimer un message

Un **clic droit** sur un message du visiteur, une réponse ou une note ouvre son menu :

- **Copier le texte** ;
- **Supprimer pour moi** : le message disparaît de votre fil, et de celui de personne d’autre ;
- **Supprimer pour tout le monde**, après confirmation : ses mots et ses fichiers sont effacés,
  et le visiteur comme l’équipe lisent « Ce message a été supprimé » à sa place, avec qui l’a
  supprimé et quand. L’IA ne le lit plus.

Un conseiller supprime pour tout le monde ses propres réponses et notes ; un superviseur,
n’importe quel message — un numéro de carte tapé par un visiteur, une réponse de l’IA. Les
événements et les cartes de transfert ne se suppriment pas : ils sont l’histoire de la
conversation.

## La palette

<kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>⌘</kbd>+<kbd>K</kbd> sur Mac), sur n’importe quel écran,
ou le champ **Rechercher…** de la barre du haut. Un seul champ pour tout ce que l’inbox
atteint :

- **Pour cette conversation** : **Me l’attribuer**, **Affecter à…**, **Remettre dans la
  file**, **Reprendre la main**, **Résoudre la conversation**, **Transférer…** ;
- les **Conversations**, les **Contacts**, et les mots des messages (**Dans les messages**) ;
- les **Conseillers** et les **Étiquettes**, pour filtrer la liste sur l’un d’eux ;
- les **Commandes** : voir la file, l’IA, l’attente ou les résolues, filtrer les non lues, les
  urgentes, celles qui attendent depuis 5 minutes, écrire un article, changer de thème ;
  pour un superviseur, inviter un conseiller et créer une boîte, une équipe, une réponse type,
  un garde-fou ou un outil ;
- les **Boîtes de réception**, la **Base de connaissance**, et **Aller à** chaque écran.

Sans rien taper, la palette propose ce qui vous attend et ce que vous avez ouvert récemment.
Les préfixes la resserrent : `>` les commandes, `#` les étiquettes, `@` les personnes. Ce qui
est ouvert souvent et récemment remonte.

## Raccourcis clavier

| Touche | Effet |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | ouvre ou ferme la palette |
| <kbd>/</kbd> | place le curseur dans la recherche de la liste |
| <kbd>Échap</kbd> | vide la recherche, puis la quitte ; décoche les conversations cochées |
| <kbd>Maj</kbd>+clic, <kbd>Ctrl</kbd>+clic | cochent une plage, une conversation de plus, dans la liste |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Entrée</kbd> | parcourent et ouvrent les résultats, les listes de choix |
| <kbd>Entrée</kbd> | envoie la réponse |
| <kbd>Maj</kbd>+<kbd>Entrée</kbd> | va à la ligne |
| <kbd>Ctrl</kbd>+<kbd>Entrée</kbd> | envoie, même depuis une liste |
| <kbd>/</kbd> dans le composeur | ouvre les réponses types |
| <kbd>Ctrl</kbd>+<kbd>B</kbd>, <kbd>I</kbd>, <kbd>U</kbd> | gras, italique, souligné |

Sur Mac, <kbd>⌘</kbd> remplace <kbd>Ctrl</kbd>.

## Volets redimensionnables

La liste et le panneau de détails s’élargissent en tirant leur bord, côté fil. Un double clic
rend la largeur de départ ; au clavier, le bord se déplace avec les flèches, quatre fois plus
vite avec <kbd>Maj</kbd>. Le fil garde toujours de quoi se lire, et le navigateur se souvient
des largeurs.

## Des adresses lisibles

L’adresse suit l’écran, en mots lisibles (D15) :

- `/conversations/service-client/lea-martin-a9ce42ba3084` : une conversation, dans sa boîte ;
- `/conversations/toutes?filtre=en-file` : toutes les boîtes, onglet **En file** — les autres
  filtres d’état sont `ia`, `ouvertes`, `en-attente` et `resolues` ;
- `/contacts/lea-martin-a9ce42ba3084`, `/connaissance/<article>`, `/tableaux-de-bord`,
  `/automatisations`.

Le nom ne sert qu’à lire ; la fin de l’identifiant retrouve la conversation, même si le
visiteur a donné son nom depuis — l’adresse est alors réécrite. Une adresse se partage avec un
collègue, qui arrive au même endroit s’il voit cette boîte. Précédent et Suivant, dans le
navigateur, refont le chemin parcouru.

Le titre de l’onglet suit de même, le plus précis d’abord, précédé de ce qui vous attend :
« (3) Léa Martin — Service client · Messagerie ». Voir [Alertes](/messagerie/fonctionnalites/alertes/).
