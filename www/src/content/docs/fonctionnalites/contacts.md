---
title: Contacts
description: Les visiteurs et les clients, anonymes ou signés par leur site, où ils sont et quelle heure il y est, sur une carte, avec leurs conversations.
---

Un **contact** est une personne qui a écrit dans le widget. Il vit dans le schéma `chat` de la
Messagerie, à part des comptes des conseillers : un visiteur n’a pas de compte (D5).

## Visiteur anonyme ou client identifié

- Un **visiteur anonyme** n’a rien prouvé. Il reçoit un nom pour qu’on le distingue —
  « Visiteur 9F0C » — jusqu’à ce qu’il donne le sien, et l’IA ne l’appelle jamais par ce nom.
- Un **client identifié** est un visiteur dont le site a **signé l’identité** (voir
  [Identité signée](/messagerie/integrations/identite-signee/)). Son nom et son adresse sont
  ceux de la signature : un script de la page ne peut pas les changer. Une pastille verte
  **Identifié par le site** le dit, partout où il paraît.

Un visiteur qui se connecte au site en cours de route devient le client : ce qu’il avait écrit
en anonyme passe à sa fiche.

Ce que la signature apporte en plus — un numéro de contrat, une date d’adhésion, un statut —
paraît sous **Transmis par le site**. Pour un visiteur anonyme, ce bloc le dit : « le site n’a
transmis aucune identité signée ».

## L’écran des contacts

**Contacts**, dans la barre latérale. À gauche, la liste ; derrière, la carte.

La liste montre les contacts dont la dernière conversation est la plus récente d’abord : nom,
drapeau du pays, bouclier vert pour un client identifié, adresse e-mail, heure du dernier
message et nombre de conversations. **Nom, e-mail ou identifiant client…** la filtre — un
identifiant client est celui que le site a signé. Le [menu des
sites](/messagerie/fonctionnalites/inbox/#le-menu-des-sites) la restreint aux contacts d’un
site.

Un conseiller n’y voit que les contacts qui ont écrit dans une boîte qu’il voit, et seulement
les conversations de ces boîtes (D12). Un superviseur les voit tous.

## La fiche

Un clic sur un contact ouvre sa fiche, sous une bande de carte centrée sur lui :

- son nom, où il est — la ville que le site a donnée, ou son pays et sa ville de référence,
  « France · heure de Paris » — et **l’heure qu’il est chez lui** ;
- son adresse e-mail, le site où il a écrit, **Identifié par le site** ou **Anonyme** ;
- **Transmis par le site** : les attributs de sa signature ;
- ses **conversations**, la plus récente d’abord, avec leur sujet — l’intention que l’IA a
  détectée, ou la première question du visiteur —, leur état et leur date. Un clic ouvre la
  conversation dans l’inbox.

L’adresse de la fiche se partage : `/contacts/lea-martin-a9ce42ba3084`. Le nom ne sert qu’à
lire ; la fin de l’identifiant retrouve le contact, même s’il a changé de nom depuis.

## Où est un contact

La Messagerie ne demande à personne où il se trouve, et ne lit pas son adresse IP (D18) : ni
base de géolocalisation, ni service tiers. Le widget transmet le **fuseau horaire** du
navigateur (`Europe/Paris`), et la table des fuseaux de la base tz en dit le pays et la ville
de référence. C’est approximatif, et dit comme tel : la carte montre alors le pays, pas la
ville. L’heure locale, elle, est exacte — c’est celle du fuseau.

Un lieu plus précis donné par un site n’est jamais remplacé par celui d’un fuseau. Un visiteur
qui voyage suit son fuseau.

### Drapeau, heure locale, carte

- Le **drapeau** est dessiné en image, pas en emoji : Windows écrit les drapeaux emoji en deux
  lettres.
- L’**heure locale** paraît sur la fiche et dans le [panneau de
  détails](/messagerie/fonctionnalites/inbox/#le-panneau-de-détails) d’une conversation : on
  sait si l’on répond à quelqu’un qui se lève ou qui va se coucher.
- La **carte** est celle d’OpenStreetMap. Sans contact choisi, chaque contact y est un point,
  et la carte se cadre sur eux tous ; un clic sur un point ouvre la fiche. Un contact choisi, elle vole jusqu’à lui — sa ville, ou son pays — et son repère
  pulse. Seules les tuiles sont demandées à OpenStreetMap, par le navigateur du conseiller.

## Les métadonnées

Une page peut joindre au contact des données de son choix — un panier, une page lue —, et un
conseiller peut en ajouter (D13). Elles se lisent et se corrigent dans le bloc **Déclaré sur le
contact** du [panneau de détails](/messagerie/fonctionnalites/inbox/#métadonnées), à côté de
celles de la conversation.

:::caution[Déclaré n’est pas prouvé]
Les métadonnées ne sont pas vérifiées : un script de la page les écrit. Seul **Transmis par le
site** vient d’une signature. Pour qu’une donnée fasse foi, le site la met dans l’identité
signée.
:::

Côté page, les métadonnées s’envoient par `setContactData` et `setConversationData` (voir
[API JavaScript](/messagerie/integrations/api-javascript/)).
