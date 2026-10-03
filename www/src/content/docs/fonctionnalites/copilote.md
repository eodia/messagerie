---
title: Copilote
description: Ce que l’IA fait pour le conseiller — suggestions de réponse, résumé, étiquettes, traduction automatique, reformulation et relecture pendant la frappe, outils lancés depuis le panneau — et l’avis du conseiller sur chaque réponse de l’IA, qui forme le jeu d’évaluation.
---

Quand un conseiller a la conversation, l’IA ne répond plus au visiteur : elle l’aide. Elle
propose des réponses, résume ce qui a été dit, range la conversation, relit le brouillon. Rien
de ce qu’elle propose ne part chez le visiteur sans que le conseiller l’envoie.

Le copilote demande un modèle d’IA configuré sur le serveur ([agent IA](/messagerie/fonctionnalites/agent-ia/#les-fournisseurs)).

## Les suggestions de réponse

Au-dessus du composeur, sous l’onglet **Répondre**, le bloc **Suggestions du copilote** propose
une à trois réponses que le conseiller peut envoyer telles quelles. Elles arrivent :

- à chaque message du visiteur, dans une conversation ouverte ou en attente ;
- quand un conseiller clique **Reprendre la main** sur une conversation de l’IA ;
- sur demande : **Demander au copilote**, à droite des onglets, ou **D’autres suggestions**
  (la flèche circulaire) dans le bloc.

Un clic sur une suggestion la met dans le champ, où le conseiller la relit, la retouche et
l’envoie avec **Envoyer** — jamais directement au visiteur. **Masquer les suggestions** (la
croix) replie le bloc ; le lien **2 suggestions**, à droite des onglets, le rouvre. Pendant que
l’IA travaille, il dit **Le copilote réfléchit…**.

Une suggestion est courte, polie, dans la langue du client. Elle s’appuie sur les mêmes sources
que l’agent IA — les passages de la [base de connaissance](/messagerie/fonctionnalites/base-de-connaissance/)
les plus proches de la question — et sur la fiche du client. Quand les sources ne suffisent
pas, elle propose de demander la précision qui manque. Elle peut porter un peu de mise en
forme : du **gras**, de l’*italique*, une liste.

## Le résumé

L’IA résume la conversation à trois moments :

- **quand elle passe la main** : la demande du visiteur en deux phrases, qui paraît aussi dans
  la carte **Transférée à un conseiller** du fil ;
- **quand un conseiller clique Reprendre la main** : en deux phrases, ce que veut le client et
  ce qui a déjà été dit ;
- **quand la conversation est résolue** : en trois phrases au plus, la demande, ce qui a été
  fait, comment elle s’est terminée.

Le dernier résumé se lit dans le panneau de détails, dans la carte **Résumé de l’IA**, et se
copie d’un clic (**Copier**).

## Intention, étiquettes, sentiment, priorité

À chaque message du visiteur, l’IA relit toute la conversation et la range :

| Ce qu’elle pose | Où le conseiller le voit |
|---|---|
| l’**intention**, en quatre mots au plus | panneau de détails, ligne **Intention**, « Détectée par l’IA » |
| les **étiquettes** qui s’appliquent | sur la conversation, avec l’étincelle « Posée par l’IA » |
| le **sentiment** du visiteur : **Positif**, **Neutre**, **Négatif** | panneau de détails, **Sentiment** |
| la **priorité** : **Basse**, **Normale**, **Haute**, **Urgente** | panneau de détails, **Priorité**, et le filtre de la liste |

L’IA ne pose que les étiquettes dont la case **L’IA peut la poser seule** est cochée, dans
**Administration › Réponses types et étiquettes** (champ « Posée par l'IA »), et les choisit
d’après leur champ **Quand l’appliquer**. Elle remplace les siennes à chaque passage ; celles
d’un conseiller restent. La priorité est haute quand le client est bloqué ou mécontent, urgente
en cas de danger ou de délai légal.

## La traduction automatique

Un visiteur qui écrit dans une autre langue que celle des conseillers est lu traduit, et les
réponses lui parviennent dans la sienne. Le conseiller écrit en français ; le visiteur lit en
allemand, en anglais, en polonais : toute langue que le modèle connaît.

- **La langue du visiteur.** L’IA la lit avec l’intention et le sentiment, à chaque message
  du visiteur. Elle est retenue sur la conversation quand son site a la case **Traduction
  automatique** cochée ([paramétrage](/messagerie/fonctionnalites/parametrage/)), ce qu’il a
  par défaut.
- **Ce que le conseiller lit.** Dans une conversation dans une autre langue, les messages du
  visiteur et les réponses de l’IA paraissent traduits en français. Sous chacun, **Écrit en
  allemand · Voir l’original** montre les mots tels qu’ils ont été écrits ; **Voir la
  traduction** revient au français. Une conversation en français ne coûte aucun appel de plus.
- **Ce que le conseiller envoie.** Sous le champ, le bouton de traduction dit la langue du
  visiteur (**DE**). Allumé — c’est le cas à l’ouverture de chaque conversation —, la réponse
  part traduite : le visiteur lit l’allemand, le conseiller garde son français dans le fil, sous
  **Envoyé en allemand · Voir l’envoi**. Éteint, elle part telle qu’elle est écrite. Une
  suggestion du copilote, déjà dans la langue du client, part telle quelle.
- **Si la traduction échoue**, la réponse ne part pas : le composeur le dit et garde le
  brouillon, à renvoyer ou à envoyer sans traduire.

Les notes ne sont jamais traduites. Chaque traduction est un appel au modèle, tracé comme les
autres (`chat.ai_run`, raison `translation`) et masqué de la même façon
([données personnelles](/messagerie/fonctionnalites/agent-ia/#les-données-personnelles)).
L’API et les webhooks donnent les messages avec leur traduction (`translation`).

## Reformuler et relire

### Reformuler

La baguette **Reformuler avec l’IA**, sous le champ, ouvre **Reformuler le brouillon** :

- **Plus clair** ;
- **Plus court** ;
- **Plus chaleureux**.

Le brouillon reformulé remplace le texte du champ, dans la même langue et en gardant le
vouvoiement. Il n’est pas envoyé : le conseiller le relit, puis l’envoie.

### Relire pendant la frappe

Après une pause dans la frappe, l’IA relit le brouillon — trois mots au moins — et propose ses
corrections dedans : le mot à changer barré en rouge, sa correction en vert à côté. Elle ne
corrige que l’orthographe, les accords, la conjugaison, la ponctuation et la typographie ; elle
ne reformule rien.

- Un clic sur un mot en vert l’accepte.
- À côté d’**Envoyer**, le composeur dit **3 corrections**, avec **Ignorer** et **Tout
  accepter** ; pendant la lecture, **Relecture…** ; quand tout est juste, **Aucune faute**.
- Écrire autre chose efface les corrections proposées ; le brouillon est relu à la pause
  suivante.

Dans le menu de la baguette, **Relire l’orthographe maintenant** lance une relecture tout de
suite, et **Relire après chaque pause** l’arrête ou la reprend. Ce choix est gardé par le
navigateur.

Le brouillon part au modèle masqué comme le reste ([données personnelles](/messagerie/fonctionnalites/agent-ia/#les-données-personnelles)).

## Les outils, depuis le panneau

La section **Outils IA** du panneau de détails offre au conseiller les outils dont la case
**Copilote** est cochée, et ceux des serveurs MCP qui ont la même case ([outils de l’IA](/messagerie/fonctionnalites/outils-ia/)).
Un clic ouvre l’outil avec ses paramètres ; **Lancer** l’appelle pour le client de cette
conversation, et la réponse s’affiche sous **Réponse**. L’appel reste dans le fil, visible de
l’équipe seulement.

Sans outil coché pour le copilote, la section le dit : « Aucun outil pour le copilote : ils se
déclarent dans le paramétrage, « Outils IA » et « Serveurs MCP ». »

Les suggestions, elles, n’appellent pas d’outil : elles s’appuient sur les sources et la fiche
du client.

## L’avis du conseiller

Sous chaque **Réponse de l’IA** du fil, le pied **Votre avis** offre trois boutons :

| Bouton | Ce qu’il enregistre |
|---|---|
| **Accepter** | la réponse était juste (`accepted`) |
| **Modifier** | elle était à corriger (`edited`) : son texte va dans le champ, à retravailler et envoyer |
| **Rejeter** | elle n’aurait pas dû partir (`rejected`) |

Un second clic sur l’avis donné le retire. Chaque conseiller donne le sien, un par réponse ;
le dernier compte. Il est rangé dans `chat.ai_feedback`, rattaché à la trace de la réponse
(`chat.ai_run`) : ces lignes forment le **jeu d’évaluation** de l’IA (D9), de quoi mesurer
l’effet d’un changement de modèle, de consignes ou d’articles.

L’avis porte sur les réponses que l’IA a envoyées au visiteur, pas sur les suggestions.

## Ce que le conseiller voit des interventions de l’IA

Tout ce que l’IA a fait dans une conversation reste dans son fil, pour l’équipe :

| Dans le fil | Ce qu’il dit |
|---|---|
| la pastille **IA en cours** | l’IA a la conversation ; **Reprendre la main** la lui retire |
| **L’IA rédige une réponse** | elle écrit en ce moment |
| la carte **Réponse de l’IA** | sa réponse, sa confiance, ses sources, et votre avis |
| la carte **Transférée à un conseiller** | le motif, le résumé, la confiance, l’équipe ([passer la main](/messagerie/fonctionnalites/agent-ia/#passer-la-main)) |
| « L’IA a utilisé l’outil « Agences Acme (démo) › trouver_agence » : ville : Lyon. » | un outil appelé, avec ses paramètres et l’issue de l’appel |
| « Léa Martin a repris la main : l’IA ne répond plus ici. » | un conseiller a pris la conversation à l’IA |

Ces événements sont rangés comme des données, pas comme des phrases (D9 bis) : chaque
conseiller les lit dans sa langue. Le visiteur ne voit ni les outils appelés, ni les sources,
ni le motif ou le résumé d’un transfert : le widget lui dit seulement qu’un conseiller va
reprendre sa demande, puis qu’il a rejoint la conversation.

L’IA lit aussi les pièces jointes, quand un conseiller le lui demande : **Analyser avec l’IA**,
sous le fichier ([pièces jointes](/messagerie/fonctionnalites/pieces-jointes/)).
