---
title: Satisfaction
description: Demander au visiteur sa note à la fin d’une conversation — CSAT de 1 à 5 ou NPS de 0 à 10, et un commentaire —, la suivre au global et par conseiller, et réagir à une mauvaise note.
---

À la fin d’une conversation, le widget peut demander au visiteur comment elle s’est passée. Sa
note et son commentaire vont dans le fil des conseillers, dans le tableau de bord
**Satisfaction**, aux automatisations et aux webhooks.

## Deux échelles

| Échelle | La question, par défaut | La note | Ce qu’on en tire |
|---|---|---|---|
| **CSAT** | « Comment s’est passée cette conversation ? » | cinq visages, de 1 (très insatisfait) à 5 (très satisfait) | le **CSAT** : la part des 4 et des 5 ; la note moyenne |
| **NPS** | « Recommanderiez-vous {site} à un proche ? » | de 0 (**Pas du tout**) à 10 (**Tout à fait**) | le **NPS** : la part des promoteurs (9 et 10) moins celle des détracteurs (0 à 6), de -100 à +100 |

Le CSAT juge une conversation ; le NPS, la relation avec la marque. La question peut être
réécrite, et citer la conversation (`{{contact.prenom}}`…) ; vide, ce sont les mots du widget,
dans sa langue.

## Demander la note

L’enquête est une étape des [automatisations](/messagerie/fonctionnalites/automatisations/) :
**Enquête de satisfaction**, avec son échelle et sa question. Le plus souvent, elle suit le
déclencheur **Conversation résolue**.

Une messagerie en a une toute prête, arrêtée : **Enquête de satisfaction à la résolution**
(« Une conversation résolue : le widget demande au visiteur une note de 1 à 5, et un mot s’il
le souhaite. »). Allumez-la dans **Administration › Automatisations** ; le modèle du même nom
la recrée au besoin. Une condition la réserve à une boîte, à un site, aux conversations qu’un
conseiller a traitées…

L’enquête n’est posée qu’**une fois par conversation** — rouverte puis résolue de nouveau, elle
ne l’est pas une seconde fois —, et jamais dans une conversation que le visiteur a quittée pour
une nouvelle. Le journal de l’automatisation le dit : « l’enquête a déjà été posée ».

## Ce que voit le visiteur

Dans le fil du widget, une carte pose la question. Le visiteur choisit sa note ; un champ
s’ouvre pour un mot (« Un mot sur votre note ? (facultatif) »), puis **Envoyer ma note**. La
carte le remercie : « Merci pour votre note : 4 sur 5. » Elle ne prend qu’une réponse. Voir
[le widget](/messagerie/fonctionnalites/widget/#lenquête-de-satisfaction).

## Ce que voient les conseillers

Le fil de la conversation garde l’enquête et sa réponse :

- « « Enquête de satisfaction à la résolution » a demandé au visiteur sa note (CSAT). » ;
- une carte **Note du visiteur** : la note dans une pastille — verte pour un visiteur satisfait,
  ambre entre les deux, rose pour un mécontent —, l’échelle, et le commentaire dessous.

## Qui est jugé

Une note juge le **conseiller qui avait la conversation** quand l’enquête a été posée. Revenue
dans la file, elle juge le dernier conseiller qui a répondu au visiteur. Sans conseiller — l’IA
a tout traité —, elle compte pour **l’IA seule**. Les réponses des jetons de l’API et des
automatisations ne font juger personne.

## Le tableau de bord

Le tableau **Satisfaction** est là dès le départ, à côté de **Vue d’ensemble** : CSAT, note
moyenne, NPS et taux de réponse de la semaine, la satisfaction semaine après semaine, les notes
données, puis par conseiller — CSAT, note moyenne, NPS, nombre de réponses —, l’IA seule face aux
conseillers, et les derniers commentaires. Un filtre **Conseiller** le restreint à l’un d’eux.
Voir [les tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/#satisfaction).

Les sources **Enquêtes de satisfaction** et **Commentaires des visiteurs** servent aussi aux
questions qu’on écrit soi-même, assistées ou en SQL (`analytics.surveys`,
`analytics.survey_comments`).

## Réagir à une note

Le déclencheur **Enquête de satisfaction répondue** lance une automatisation à chaque réponse.
Sa condition **Note donnée** (inférieure à, supérieure à) la réserve aux mauvaises notes, ou aux
bonnes ; ses textes citent `{{enquete.note}}`, `{{enquete.sur}}` (5 ou 10) et
`{{enquete.commentaire}}`. Le modèle **Alerter sur une mauvaise note** pose l’étiquette
« Insatisfait » sur une note de 1 ou 2, et prévient les superviseurs :

> Léa Martin a donné 2/5 à Nadia Benali : Trop long à obtenir une réponse.

Pour un autre système — un CRM, un outil de qualité —, le webhook `survey.answered` porte la
réponse ([webhooks](/messagerie/integrations/webhooks/)).
