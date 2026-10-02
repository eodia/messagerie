---
title: Conseillers et droits
description: Les conseillers ont leur compte dans la messagerie — mot de passe, lien d’invitation, fournisseur d’identité de l’entreprise —, un rôle, conseiller ou superviseur, et voient les boîtes de leurs équipes.
---

**Un conseiller a son compte dans la messagerie** (D4, D19) : sa ligne de la table
« Conseillers » est à la fois sa fiche et son compte. Il se connecte avec son adresse e-mail et
son mot de passe, ou par le fournisseur d’identité de l’entreprise. Ce que la fiche dit en
plus, c’est **ce qu’il voit** — des boîtes de réception, par ses équipes — et **ce qu’il peut
régler** — selon son rôle.

## Se connecter

La mire de l’inbox demande l’**Adresse e-mail** et le **Mot de passe**, puis **Se connecter**.
Une adresse inconnue et un mauvais mot de passe reçoivent la même réponse : « Adresse ou mot de
passe incorrect. » Dix essais par quart d’heure et par adresse e-mail, trente par adresse IP ;
au-delà : « Trop d’essais : patientez un quart d’heure avant de recommencer. »

La session tient dans un cookie, trente jours depuis son dernier usage ; **Se déconnecter**, dans
le menu du compte, la ferme. Le même menu offre **Changer mon mot de passe** : le mot de passe
actuel, puis le nouveau, deux fois ; les autres sessions sont alors fermées. Un mot de passe a
huit caractères au moins, et n’est pas l’adresse e-mail.

Sous le formulaire, **Première connexion, mot de passe oublié ?** rappelle la règle : c’est un
superviseur qui donne un lien ([inviter un conseiller](#inviter-un-conseiller)).

:::note[Au premier lancement]
Tant que personne ne peut se connecter, la mire devient **Bienvenue dans la messagerie** : elle
crée le compte du premier superviseur, qui invite les autres conseillers
([installation](/messagerie/guides/installation/)).
:::

### Par le fournisseur d’identité de l’entreprise

Quand le serveur connaît un fournisseur OpenID Connect — Microsoft Entra, Google, Keycloak… —,
la mire offre aussi **Continuer avec SSO** — ou le nom que l’hébergeur lui donne
(`CHAT_OIDC_NAME`), « Continuer avec Microsoft » par exemple. Le fournisseur
connecte le conseiller **de la même adresse e-mail**, qu’il a vérifiée ; la messagerie retient
ensuite cette identité, même si l’adresse change chez lui.

Il ne crée personne : un compte inconnu de la messagerie, ou désactivé, lit « Ce compte n’est
pas celui d’un conseiller actif de la messagerie. » On invite donc d’abord. Le réglage du
fournisseur (`CHAT_OIDC_ISSUER`, `CHAT_OIDC_CLIENT_ID`, `CHAT_OIDC_CLIENT_SECRET`) est décrit
avec l’hébergement : voir [comptes et connexion](/messagerie/hebergement/comptes/).

## Être conseiller

Être conseiller, c’est avoir une ligne **active** dans « Conseillers ». Chaque conseiller a un
**rôle** :

| Rôle | Ce qu’il fait |
|---|---|
| **Conseiller** | voit les boîtes de ses équipes, répond, affecte, transfère |
| **Superviseur** | voit toutes les boîtes, et règle le paramétrage |

Un rôle changé vaut aussitôt : le serveur relit le compte à chaque requête.

## Inviter un conseiller

Dans **Administration › Équipes et conseillers**, onglet **Conseillers**, **Inviter un
conseiller** — ou la même commande dans la palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>). On donne
son **Nom**, son **Adresse e-mail**, son **Rôle** et ses **Équipes**, puis **Inviter**.

1. Sa fiche est créée aussitôt, active, avec cette adresse pour connexion.
2. Un **Lien à transmettre** s’affiche **une seule fois**, avec **Copier** : « Il ne
   s’affichera plus, et vaut sept jours, une seule fois : transmettez-le maintenant. »
3. La personne ouvre le lien : **Bienvenue**, son prénom, et le choix de son mot de passe ;
   **Rejoindre la messagerie** la connecte.

Une adresse qui est déjà celle d’un conseiller est refusée : « Cette adresse est déjà celle
d’un conseiller. » Un lien qui a servi, ou expiré, mène à **Lien inutilisable** : « Ce lien ne
vaut plus : il a servi, ou il a expiré. Demandez-en un autre. »

### Un mot de passe oublié

Sur la fiche d’un conseiller, section **Connexion**, **Créer un lien** donne un nouveau lien,
de même sorte : sept jours, une seule fois, affiché une fois. La personne y choisit un
nouveau mot de passe ; ses sessions ouvertes sont alors fermées. Un nouveau lien annule le
précédent. Le même bouton sert à une invitation dont le lien s’est perdu.

L’**Adresse e-mail** de la fiche est celle de la connexion : la changer change l’adresse avec
laquelle la personne se connecte.

### Désactiver un conseiller

L’interrupteur **Actif** / **Désactivé**, en tête de sa fiche, puis **Enregistrer** — ou
**Retirer le conseiller**, au pied de la fiche — le désactive. Il ne peut plus se connecter, ni par mot de passe ni par le fournisseur
d’identité, et sa session ouverte ne vaut plus : sa requête suivante le ramène à la mire.

**Un conseiller n’est jamais supprimé** : sa ligne reste, pâlie dans la liste, et ses messages
gardent son nom. Le réactiver lui rend son compte.

## Qui voit quoi : boîtes et équipes

Une **boîte de réception** dit où arrivent les conversations ; une **équipe**, qui y répond
(D12). Ce sont deux tables distinctes, et une même équipe peut servir plusieurs boîtes :

- **Boîtes de réception** nomme, pour chaque boîte, les équipes qui y répondent et son équipe
  par défaut ;
- **Conseillers** nomme les équipes de chaque conseiller ; on peut être de plusieurs.

Un site nomme la boîte où arrivent ses conversations. Une nouvelle conversation reçoit la boîte
de son site et l’équipe par défaut de cette boîte.

**Un conseiller voit les boîtes qu’une de ses équipes sert.** **Un superviseur les voit
toutes.** La règle vaut partout, côté serveur :

- la liste des conversations et leur fil ;
- les signaux en direct, et donc le son et les notifications ;
- la cloche ;
- les contacts — ceux qui ont écrit dans ces boîtes — et leurs conversations ;
- les compteurs.

Les [tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/) font exception : un tableau
visible des conseillers montre à chacun les mêmes chiffres, toutes boîtes confondues.

Une conversation d’avant les boîtes, qui n’en a pas, est à tous. Un conseiller sans équipe, ou
dont les équipes ne servent aucune boîte, ne voit que ces conversations sans boîte : sa fiche
le signale, sous **Ce qu’il voit**.

Le [menu des sites](/messagerie/fonctionnalites/inbox/#le-menu-des-sites) n’est pas un droit :
il restreint l’écran à un site parmi ceux qu’on voit déjà.

Transférer une conversation la fait passer d’une boîte ou d’une équipe à l’autre : elle peut
alors quitter la vue de celui qui l’a transférée (voir
[l’inbox](/messagerie/fonctionnalites/inbox/#transférer)).

## Ce qu’un superviseur peut de plus

- **Voir toutes les boîtes**, et tous les sites.
- **Régler la Messagerie** : la section **Administration** de la barre latérale — boîtes de
  réception, équipes et conseillers, sites et horaires, réponses types et étiquettes,
  garde-fous, outils de l’IA, automatisations, widget, API et MCP (voir
  [Paramétrage](/messagerie/fonctionnalites/parametrage/)). Un conseiller qui arrive sur l’un
  de ces écrans par son adresse lit **Réservé aux superviseurs** ; le serveur lui refuse de
  toute façon l’écriture, et la lecture de ces tables — sauf les sites, les articles, leurs
  catégories et les conversations promues.
- **Écrire la base de connaissance** : les articles, les catégories, et la relecture des
  conversations promues ([base de connaissance](/messagerie/fonctionnalites/base-de-connaissance/)).
- **Inviter des conseillers**, leur donner un lien pour un nouveau mot de passe, changer leur
  rôle, les désactiver.
- **Faire les tableaux de bord** : les créer, y poser des questions — en SQL comprises —,
  choisir ceux que voient les conseillers ([tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/)).
- **Créer les jetons de l’API et du MCP**, et les **webhooks** (voir
  [API REST](/messagerie/integrations/api-rest/) et [Webhooks](/messagerie/integrations/webhooks/)).
- **Supprimer n’importe quel message pour tout le monde** — un conseiller ne supprime ainsi que
  ses propres réponses et notes.
- **Être prévenu des transferts** de l’IA à une équipe, et des transferts d’une boîte ou d’une
  équipe à l’autre, même hors de ses équipes.

Dans la liste des conseillers à qui confier une conversation, un bouclier violet marque les
superviseurs.

## Un jeton n’est pas un conseiller

Un programme qui passe par l’[API REST](/messagerie/integrations/api-rest/) ou le
[serveur MCP](/messagerie/integrations/mcp/) agit avec un jeton, pas avec un compte. Il signe
ce qu’il écrit de son nom, mais ne figure dans aucune liste de conseillers, ne reçoit aucune
alerte, ne se connecte pas à l’inbox, et ne prend pas de conversation : une réponse envoyée par
un jeton la laisse dans la file (D16).

## Une automatisation non plus

Une [automatisation](/messagerie/fonctionnalites/automatisations/) agit sous sa propre ligne de
conseiller, jamais active : le fil signe de son nom ce qu’elle fait, mais elle ne figure dans
aucune liste, ne reçoit aucune alerte et ne se connecte pas. Le visiteur lit ses réponses au nom
du site (D20).
