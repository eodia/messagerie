---
title: Automatisations
description: Faire faire à la messagerie ce que l’équipe refait à la main — un déclencheur, une condition, des étapes —, dessiné en flux, avec ses modèles et le journal de ses exécutions.
---

Une automatisation part d’un **déclencheur**, retient les **conversations** qui remplissent sa
condition, et enchaîne des **étapes** : attribuer, étiqueter, répondre, prévenir, appeler un
autre système, demander à l’IA, attendre (D20). C’est le flux des automatisations de basedb,
dessiné de même, fait pour les conversations.

Elles se règlent dans **Administration › Automatisations** (`/automatisations`), par les
superviseurs seuls.

## L’écran

- **À gauche**, les automatisations : leur déclencheur, leurs exécutions des sept derniers
  jours et celles en échec, et l’interrupteur qui les active ou les arrête.
- **Au milieu**, le flux de celle qui est choisie : le déclencheur en tête, puis une carte par
  étape. Un **+** sur chaque lien ajoute une étape à cet endroit ; une condition ouvre ses
  chemins côte à côte.
- **À droite**, onglet **Réglages**, ce qui est choisi sur le flux — le déclencheur, une étape,
  un chemin — ; onglet **Exécutions**, le journal.

**Nouvelle automatisation** part d’une **Page blanche** ou d’un modèle (**Partir d’un
modèle**). Une nouvelle automatisation s’enregistre arrêtée, et ne s’active qu’une fois que
rien ne l’empêche de tourner ; une automatisation active ne s’enregistre que si elle le peut
encore. Ce qui l’en empêche est dit sur l’étape concernée : « Choisissez l’équipe. »,
« Écrivez le message. »…

## Les déclencheurs

| Déclencheur | Quand |
|---|---|
| **Nouvelle conversation** | un visiteur commence une conversation |
| **Message du visiteur** | chaque fois que le visiteur écrit |
| **L’IA passe la main** | l’IA transfère la conversation aux conseillers |
| **Conversation attribuée** | elle est confiée à quelqu’un, ou remise dans la file |
| **Conversation transférée** | elle change de boîte ou d’équipe |
| **Conversation résolue** | un conseiller ou l’IA la clôt |
| **Conversation rouverte** | une conversation résolue reprend |
| **L’humeur change** | l’IA lit une autre humeur dans les mots du visiteur |
| **Visiteur sans réponse** | le visiteur attend une réponse depuis N minutes |
| **Message non remis** | un SMS ou un e-mail n’a pas atteint le client : le fournisseur le dit non remis, ou le serveur d’e-mail le refuse |
| **À heure fixe** | chaque heure, chaque jour, en semaine ou chaque semaine, à l’heure dite |
| **Bouton dans la conversation** | un conseiller la lance depuis la conversation |
| **Appel d’un autre système** | un CRM, un ERP… appelle son adresse |

- **Visiteur sans réponse** regarde, chaque minute, les conversations de l’IA ou des conseillers
  dont le dernier message est celui du visiteur, plus vieux que le délai. Une automatisation ne
  part qu’une fois par message resté sans réponse, et seulement pour les messages arrivés depuis
  son activation.
- **À heure fixe** part une fois, sans conversation ; ou, avec **Pour chaque conversation**, une
  fois pour chaque conversation que la condition retient parmi celles qui ont eu un message dans
  les 90 derniers jours — 200 au plus à chaque passage. Les étapes qui agissent sur une
  conversation demandent **Pour chaque conversation**.
- **Bouton dans la conversation** : dans le fil, le menu **Plus d’actions** propose, sous
  **Automatisations**, celles dont la conversation remplit la condition. « « … » est lancée. »
- **Message non remis** part une fois par réponse perdue, quand le facteur renonce ou que le
  fournisseur répond « non remis » (voir [SMS et RCS](/messagerie/fonctionnalites/sms-et-rcs/)). Avec la
  condition **Canal**, il écrit par l’autre canal : le modèle **Un SMS ou un RCS non remis :
  écrire par e-mail** le fait.
- **Appel d’un autre système** : voir [plus bas](#appelée-par-un-autre-système).

## La condition

**Pour les conversations qui…** : des règles, toutes (**Toutes les règles**) ou l’une d’elles
(**L’une des règles**). Sans règle : toutes les conversations.

| Champ | Comparaisons |
|---|---|
| **Boîte de réception**, **Équipe**, **Conseiller** | est, n’est pas, est vide, n’est pas vide |
| **Site**, **Statut**, **Priorité** | est, n’est pas |
| **Canal** — **Widget**, **SMS**, **RCS**, **E-mail** : celui du dernier message du client | est, n’est pas |
| **Humeur** | est, n’est pas, est vide, n’est pas vide |
| **Étiquettes** | contient l’une de, ne contient aucune de |
| **Client identifié** | oui, non |
| **Horaires du site** | ouvert en ce moment, fermé en ce moment |
| **Message du visiteur** — celui qui a lancé l’automatisation —, **Donnée de la conversation**, **Résultat d’une étape** | contient, ne contient pas, vaut, ne vaut pas, est vide, n’est pas vide |
| **Sans message depuis** | plus de, moins de (minutes) |

La condition est relue au moment où l’automatisation se lance.

## Les étapes

| Étape | Ce qu’elle fait |
|---|---|
| **Attribuer** | à un conseiller ; au moins occupé d’une équipe ; à tour de rôle dans une équipe — parmi ses membres actifs, sous leur limite de conversations simultanées ; ou **Personne** : la conversation retourne dans la file |
| **Transférer** | vers une autre boîte de réception ou une autre équipe |
| **Étiqueter** | ajouter ou retirer des étiquettes |
| **Changer la priorité** | basse, normale, haute ou urgente |
| **Changer le statut** | **Aux conseillers** (sortie des mains de l’IA, rouverte ou réveillée : elle revient dans la file), **Résolue**, ou **En attente** pendant un nombre d’heures |
| **Noter une donnée** | une valeur jointe à la conversation, que le panneau des conseillers montre et que l’IA lit |
| **Répondre au visiteur** | un message, signé du nom de l’automatisation dans l’inbox ; le visiteur le lit au nom du site. Une conversation avec l’IA y reste |
| **Écrire par SMS, RCS ou e-mail** | un message au contact de la conversation, sur son téléphone ou à son adresse, comme **Nouveau message** dans l’inbox (voir plus bas) |
| **Ajouter une note** | une note que seule l’équipe lit |
| **Demander l’e-mail du visiteur** | le widget lui propose de laisser son adresse (voir [plus bas](#demander-le-mail-du-visiteur)) |
| **Prévenir** | une ligne dans la cloche du conseiller de la conversation, d’une équipe, des superviseurs ou de personnes choisies — et sur leur bureau s’ils ont activé les notifications |
| **Appeler une adresse** | un `POST` en JSON vers un CRM, un ERP, un outil interne |
| **Demander à l’IA** | **Classer** — l’IA choisit une réponse parmi celles qu’on lui donne — ou **Rédiger** un texte, d’après une consigne et la conversation |
| **Condition** | des chemins selon la conversation ; le chemin **Sinon** est pris quand aucun autre ne l’est |
| **Attendre** | reprendre plus tard, en minutes, heures ou jours ; **Sauf si le visiteur écrit entre-temps** arrête l’exécution là |

Soixante étapes au plus, quatre conditions imbriquées au plus. Une étape qui n’a rien à faire
est passée, et le journal le dit : « déjà fait », « personne de libre dans l’équipe », « le
visiteur a déjà une adresse, ou on la lui a demandée ».

### Écrire par SMS, RCS ou e-mail

L’étape écrit au **contact** de la conversation — y compris quand elle n’est pas sur ce canal :
c’est ainsi qu’une conversation du widget se poursuit sur le téléphone du client.

- **SMS / RCS** : au numéro du contact, depuis le numéro choisi sous **Depuis** (s’il y en a
  plusieurs), sinon celui de son site. Le message part **en RCS** si ce numéro l’envoie
  (service de messagerie Twilio, ou **Envoyer en RCS** chez SMS Mode) et que le téléphone du
  client le lit, **en SMS** sinon. Sa réponse arrive dans la conversation de son téléphone.
- **E-mail** : à l’adresse du contact, depuis l’[adresse e-mail du site](/messagerie/fonctionnalites/e-mail/)
  s’il en a une — sa réponse revient alors dans la conversation —, sinon par le serveur
  d’e-mails de la messagerie (`CHAT_SMTP_URL`), et le client répond en revenant sur le site.
- Sans numéro ou sans adresse, l’étape passe : « le contact n’a pas de numéro », « le contact
  n’a pas d’adresse e-mail ».

Le message cite la conversation comme les autres textes. Le résultat de l’étape est le numéro
ou l’adresse écrite ; l’événement de la conversation garde l’automatisation qui l’a causé.

### Citer la conversation

Les textes — réponse, note, notification, consigne de l’IA, adresse et corps d’un appel —
citent la conversation entre doubles accolades, choisies dans le menu **Citer** :

| Citation | Ce qu’elle donne |
|---|---|
| `{{contact.nom}}`, `{{contact.prenom}}`, `{{contact.nom_de_famille}}`, `{{contact.email}}`, `{{contact.telephone}}` | le contact |
| `{{conversation.lien}}`, `{{conversation.site}}`, `{{conversation.boite}}`, `{{conversation.equipe}}`, `{{conversation.conseiller}}`, `{{conversation.priorite}}`, `{{conversation.resume}}`, `{{conversation.etiquettes}}` | la conversation |
| `{{message.texte}}` | le message qui a lancé l’automatisation |
| `{{donnees.<clé>}}` | une donnée de la conversation |
| `{{etape.s2}}` | le résultat d’une étape qui vient avant : la réponse de l’IA, ce qu’a répondu une adresse |
| `{{webhook.<champ>}}` | un champ de l’appel reçu, pour une automatisation appelée par un autre système |
| `{{automatisation.nom}}` | son nom |

Ce qui ne désigne rien est remplacé par rien.

### Appeler une adresse

Un `POST` en JSON, en HTTPS, vers une adresse publique — les mêmes règles que les
[webhooks](/messagerie/integrations/webhooks/), `CHAT_WEBHOOK_ALLOW` compris —, dix secondes au
plus, sans suivre de redirection. Des en-têtes au choix ; une valeur `${NOM}` y est lue dans
l’environnement du serveur, comme pour les [outils de l’IA](/messagerie/fonctionnalites/outils-ia/).

**Corps** vide : l’automatisation, la conversation, le contact et les résultats des étapes. Un
corps écrit doit rester du JSON valable une fois les citations remplacées :

```json
{
  "client": "{{contact.email}}",
  "demande": "{{message.texte}}"
}
```

Une réponse hors `2xx` fait échouer l’étape (« L’adresse a répondu 500. ») ; ce que l’adresse
renvoie se cite ensuite, `{{etape.s3}}`.

### Demander à l’IA

L’IA lit les trente derniers messages de la conversation — données personnelles masquées vers
un modèle externe, comme pour ses réponses — et la consigne. En **Classer**, elle choisit une
des **Réponses possibles** (« Sinistre, Contrat, Paiement… »), qu’une condition teste ensuite ;
en **Rédiger**, elle écrit le texte demandé. Chaque appel est tracé comme les autres appels à
l’IA. Il faut un modèle sur le serveur (`CHAT_AI_API_KEY`) : sans lui, l’étape échoue, et
l’éditeur le dit.

## Demander l’e-mail du visiteur

Quand personne ne peut répondre tout de suite, le widget peut proposer au visiteur de laisser
son adresse : une carte **Laissez-nous votre e-mail** dans le fil, avec le texte de l’étape —
vide, celui du widget. L’adresse laissée va sur le contact, et le fil des conseillers le dit :
« Le visiteur a laissé son e-mail : … ».

La carte ne paraît qu’une fois par conversation, et seulement pour un contact qui n’a pas
d’adresse. Voir [le widget](/messagerie/fonctionnalites/widget/#laissez-nous-votre-e-mail).

### Celle qui est là dès le départ

Une messagerie commence avec une automatisation active, **Demander l’e-mail quand la réponse
tarde** : « Cinq minutes sans réponse : le widget propose au visiteur de laisser son adresse,
pour lui répondre plus tard. » Elle se lit, se change ou s’arrête comme les autres.

Sans elle, le widget demande quand même l’adresse dans un cas : quand l’IA passe la main
alors que le site est fermé.

## Les modèles

**Partir d’un modèle** propose des automatisations prêtes à régler :

| Modèle | Ce qu’il fait |
|---|---|
| **Demander l’e-mail quand la réponse tarde** | après 5 minutes sans réponse, le widget propose au visiteur de laisser son adresse |
| **Relancer un visiteur silencieux** | 24 heures après la réponse d’un conseiller, une relance — sauf s’il a écrit entre-temps |
| **Escalader les clients mécontents** | une humeur négative passe en priorité haute, et les superviseurs sont prévenus |
| **Répartir à tour de rôle** | ce que l’IA transfère va aux membres d’une équipe, chacun son tour |
| **Hors horaires : prévenir et étiqueter** | une conversation qui commence site fermé reçoit un mot, et l’étiquette « À rappeler » |
| **Clore les conversations en attente depuis 7 jours** | chaque matin, ce qui dort depuis une semaine est résolu |
| **Un SMS ou un RCS non remis : écrire par e-mail** | une réponse par SMS ou RCS qui n’arrive pas part par e-mail, et une note le dit à l’équipe |
| **Trier par sujet avec l’IA** | l’IA classe la première demande, puis la conversation part vers la bonne boîte |

## Essayer, et le journal

**Essayer sur une conversation** lance l’automatisation enregistrée sur la conversation choisie,
active ou non, sans regarder sa condition. « Ce qu’elle fait, elle le fait pour de bon. »

L’onglet **Exécutions** donne, pour chaque exécution, ce qui l’a lancée, son statut — **En
file**, **En cours**, **En attente**, **Réussie**, **Échouée**, **Arrêtée** —, sa durée, et le
détail de chaque étape. Une exécution en attente reprend à l’heure dite ; **Arrêter cette
exécution** arrête une exécution en file ou en attente. Les exécutions sont gardées 90 jours, et se comptent aussi dans les
[tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/) (source « Exécutions
d’automatisations »).

## Appelée par un autre système

Avec le déclencheur **Appel d’un autre système**, l’automatisation a une adresse, qui paraît
une fois l’automatisation enregistrée, avec **Copier l’adresse** :

```bash
curl -X POST "https://chat.exemple.fr/api/automations/<id>/hook?key=ahk_…" \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "4f1c…", "commande": "A-1042"}'
```

- La clé se passe dans l’adresse (`?key=`) ou dans l’en-tête `X-Messagerie-Key`. L’adresse la
  contient : gardez-la secrète. **Changer la clé** en donne une nouvelle, et l’ancienne cesse
  de valoir.
- Le corps est du JSON, 64 000 caractères au plus ; ses champs se citent `{{webhook.commande}}`.
- Un `conversationId` dans le corps fait agir l’automatisation sur cette conversation.
- Le serveur répond `202` : l’exécution est en file.

## Comment elles tournent

- **Le moteur** lit, toutes les deux secondes, les événements que captent les déclencheurs de
  la base — les mêmes que pour les webhooks (D17) —, crée les exécutions des automatisations
  qui écoutent, et les mène étape par étape. Plusieurs processus peuvent le faire ensemble.
  Il tourne là où tournent les webhooks : dans le serveur, ou dans le worker avec
  `CHAT_WORKER=separate`. Il ne dépend pas de l’IA.
- **Une automatisation agit sous sa propre ligne de conseiller**, jamais active : le fil dit
  qui a fait quoi, au nom de l’automatisation. Elle ne figure dans aucune liste et ne reçoit
  aucune alerte.
- **Pas de boucle** : une automatisation ne se déclenche jamais sur ce que sa propre exécution a
  fait ; une chaîne d’automatisations qui se lancent l’une l’autre s’arrête à trois ; une
  automatisation tourne cent fois par heure au plus — au-delà, l’exécution est abandonnée, et
  le journal du serveur le dit.
- **Une exécution interrompue** — le processus est tombé — échoue (« Le serveur s’est arrêté
  pendant l’exécution. ») plutôt que de recommencer : ses étapes ont peut-être déjà écrit.
