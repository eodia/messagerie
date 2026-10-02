---
title: Alertes
description: Le son, les notifications du bureau, les pastilles de l’onglet et la cloche de chaque conseiller — qui est prévenu de quoi, et comment le régler.
---

Un conseiller ne garde pas les yeux sur la liste. L’inbox l’appelle quand une conversation a
besoin de lui, et seulement alors : ce qui revient à un collègue, ou ce à quoi l’IA répond, ne
le dérange pas.

La règle tient en une phrase : **le serveur dit pourquoi, l’inbox décide pour qui** (D9 ter).

## Ce qui appelle un conseiller

Six écritures appellent un conseiller. Chacune le dit au serveur, qui écrit dans la même
transaction une ligne dans la cloche de chaque conseiller concerné :

| Cause | Qui la trouve dans sa cloche |
|---|---|
| **Un visiteur écrit** | le conseiller qui a la conversation. Personne tant que l’IA répond |
| **L’IA transfère** | le conseiller désigné ; sinon les membres de l’équipe qui la reçoit, et les superviseurs |
| **Une conversation est confiée** | celui qui la reçoit, sauf s’il se l’est donnée lui-même |
| **Une conversation est transférée** | les conseillers de la boîte ou de l’équipe qui la reçoit, et les superviseurs, sauf l’auteur du transfert |
| **Une attente prend fin** | le conseiller qui l’avait, quand l’heure est venue |
| **Une automatisation prévient** | ceux que nomme son étape **Prévenir** : le conseiller de la conversation, une équipe, les superviseurs ou des personnes choisies ([automatisations](/messagerie/fonctionnalites/automatisations/)) |

Le son et la notification du bureau suivent une règle à part, décidée par l’inbox (voir
plus bas). Les deux respectent la visibilité par boîte (D12) : on n’est jamais prévenu d’une
conversation qu’on ne peut pas ouvrir.

## La cloche

En haut à droite de chaque écran. Elle garde, conseiller par conseiller, ce qui l’a appelé :
« Léa Martin vous a écrit », « L’IA a transféré la conversation de… », « Julie vous a confié
la conversation de… », « … a transféré à votre équipe… », « … revient de l’attente », ou le texte
qu’une automatisation y écrit. Son compteur dit ce qui n’est pas lu.

- Une seule ligne non lue par conversation et par cause : un visiteur qui écrit cinq fois sonne
  cinq fois, mais ne laisse qu’une ligne, remontée en tête.
- **Ouvrir la conversation** lit ses lignes, d’où qu’on l’ouvre.
- **Tout marquer comme lu** vide le compteur. Les autres onglets ouverts du même conseiller le
  voient aussitôt.

La cloche montre les cinquante dernières lignes ; un clic ouvre la conversation, et revient à
**Tous les sites** si elle est d’un autre site que celui choisi.

Un visiteur qui écrit dans une conversation de la file, que personne n’a encore prise, fait
sonner tous ceux qui la voient, mais n’écrit dans la cloche de personne : elle se lit dans
l’onglet **En file**.

## Le son et le bureau

Quand une alerte concerne le lecteur, l’inbox :

- **sonne** : deux notes pour un message de visiteur, trois pour ce qu’on lui confie — un
  transfert de l’IA, une affectation, un transfert d’équipe — et une autre suite de trois pour
  une attente finie. On les distingue sans regarder. Le son est synthétisé : aucun fichier à
  charger ;
- affiche une **notification du bureau** si l’onglet n’est pas au premier plan. Une seule par
  conversation : un deuxième message remplace la première. Un clic dessus ramène à l’inbox,
  conversation ouverte ;
- **ne fait rien** si le lecteur a déjà la conversation sous les yeux : elle est marquée lue.

Une alerte concerne le lecteur si la conversation est la sienne, ou si elle attend dans la file
sans conseiller. Celle d’une automatisation ne va qu’à ceux qu’elle prévient. Une conversation
confiée ou sortie de l’attente ne sonne que pour son conseiller ; une conversation en attente ne
sonne pour personne.

:::note[Le premier clic]
Les navigateurs taisent une page tant qu’on n’y a pas cliqué ni tapé. Le son ne joue donc qu’après
un premier clic ou une première touche dans l’inbox, après chaque chargement de la page.
:::

## Les pastilles

Les pastilles comptent **ce qui attend le lecteur** : les conversations non lues qui sont les
siennes, ou qui sont dans la file sans conseiller. Pas celles de l’IA, ni d’un collègue, ni en
attente.

- **L’onglet du navigateur** : « (3) Léa Martin — Service client · Messagerie », et un point
  vert sur son icône — un onglet parmi vingt dit qu’il a quelque chose.
- **La barre latérale** : le compteur de **Conversations** et celui de chaque boîte.
- **Le menu des sites** : le compte de chaque site, et un point sur le menu quand un autre site
  que celui choisi a quelque chose.

L’onglet compte pour tous les sites, quel que soit le site choisi : ce qui vous attend reste à
vous. La barre latérale compte dans le site choisi. La cloche, elle, compte ses lignes non lues.

## Régler les alertes

Dans le menu du compte, en bas de la barre latérale, sous **Alertes** :

| Réglage | Par défaut |
|---|---|
| **Son à chaque nouveau message** | activé |
| **Notifications du bureau** | désactivé ; l’activer demande la permission au navigateur |
| **Mode audio** | désactivé ; voir [l’inbox](/messagerie/fonctionnalites/inbox/#mode-audio--lecture-et-dictée) |

Les notifications du bureau sont aussi proposées une fois, au pied de la liste des
conversations : « Être prévenu par Windows ou macOS quand un visiteur écrit, même dans un autre
onglet. » **Activer les notifications** demande la permission au navigateur ; la croix la
ferme. Dans les deux cas, elle ne revient plus dans ce navigateur : le réglage reste dans le menu
du compte.

Ces réglages valent **pour ce navigateur** : un poste partagé n’est pas un ordinateur
personnel. Si le navigateur a refusé les notifications, l’entrée devient **Notifications
bloquées par le navigateur** ; il faut alors les autoriser dans ses réglages.

La cloche ne se règle pas : elle garde tout ce qui vous a appelé, son et bureau coupés compris.
