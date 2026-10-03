---
title: Tableaux de bord
description: Des cartes sur une grille — indicateurs, tableaux, graphiques —, chacune une question posée aux conversations, assistée ou en SQL, sous des titres de section, avec « Vue d’ensemble » pour commencer.
---

L’écran **Tableaux de bord** remplace les anciennes statistiques (D22). Un tableau de bord est
une grille de cartes ; chaque carte est une **question** posée aux conversations, dessinée en
nombre, en tableau ou en graphique. C’est le principe des tableaux de bord de basedb, fait pour
les conversations.

Il s’ouvre depuis la barre latérale, sous **Connaissances**, ou par la palette (Ctrl+K). Son
adresse est `/tableaux-de-bord`, suivie du nom du tableau ouvert ; l’ancienne adresse
`/statistiques` y mène.

## Qui voit quoi

| | Conseiller | Superviseur |
|---|---|---|
| Ouvrir un tableau **visible des conseillers** | oui | oui |
| Ouvrir un tableau privé | non | oui |
| Créer, modifier, supprimer un tableau | non | oui |
| Écrire une question, assistée ou en SQL | non | oui |

Un conseiller n’envoie jamais de question : il demande une carte, et le serveur l’exécute telle
qu’elle a été enregistrée. Dans le menu des tableaux, un tableau privé porte la mention
**privé**.

:::note[Toutes les conversations]
Une carte compte toutes les conversations, quelles que soient les boîtes du lecteur et le site
choisi dans le [menu des sites](/messagerie/fonctionnalites/inbox/#le-menu-des-sites). Pour
une carte limitée à une boîte ou à un site, ajoutez le filtre à sa question.
:::

## Vue d’ensemble

La première fois qu’on ouvre l’écran, la messagerie crée **Vue d’ensemble**, visible des
conseillers — « Ce qui se passe dans les conversations : volume, IA, délais, humeur, équipe. » :

- trois filtres : **Période** (les 30 derniers jours à l’ouverture), **Boîte de réception** et
  **Site** ;
- sous **Activité**, quatre indicateurs de la semaine comparée à la précédente : les
  conversations, la part que l’IA a résolue seule parmi celles où elle a répondu, la médiane de
  la première réponse, et les conversations transférées par l’IA — pour ces deux dernières, une
  baisse est une bonne nouvelle ; puis les conversations par jour, et par boîte de réception ;
- sous **Visiteurs et IA**, l’humeur des visiteurs, les étiquettes les plus posées et l’avis des
  conseillers sur l’IA ;
- sous **Équipe**, les conversations par conseiller et les heures où les visiteurs écrivent.

C’est un tableau comme les autres : un superviseur le modifie ou le supprime. S’il ne reste plus
aucun tableau, l’écran le recrée à sa prochaine ouverture.

## Les cartes

Sur une grille de douze colonnes, chaque carte a sa place et sa taille. Une carte montre :

| Graphique | Pour |
|---|---|
| **Nombre** | une seule valeur — celle du dernier groupe, si la question regroupe |
| **Tendance** | la dernière période d’une question regroupée par date, et son écart avec la précédente : une flèche, le pourcentage, en vert ou en rouge selon que c’est une bonne nouvelle |
| **Objectif** | une barre vers un objectif chiffré, avec ce qu’il reste à faire |
| **Tableau** | des lignes telles quelles |
| **Barres**, **Barres horizontales** | comparer, classer ; empilées si la question a deux regroupements |
| **Courbe**, **Aire** | une évolution dans le temps |
| **Camembert** | une répartition en quelques parts |

Les couleurs suivent une palette fixe, claire ou sombre selon le thème. Une humeur ou un avis
garde la couleur de son sens : négative ou rejeté en rouge, positive ou accepté en vert.

Le bouton **Voir les chiffres** d’une carte montre son résultat en tableau, **Voir le
graphique** y revient. Une carte montre 2 000 lignes au plus, et le dit : « Les 2 000 premières
lignes seulement. » **Actualiser**, en haut de l’écran, relit toutes les cartes ; elles ne
bougent pas seules.

Un tableau se trie d’un clic sur l’en-tête d’une colonne : un clic trie, un deuxième inverse
l’ordre, un troisième rend l’ordre de la question. L’en-tête reste visible quand on fait défiler
les lignes, et les nombres sont alignés à droite.

Une carte **Titre** sépare les sections du tableau ; une carte **Texte** porte une explication,
sans question.

## Le détail d’une carte

Un clic sur le **titre** d’une carte l’ouvre en grand, sous les filtres du tableau :

- **Graphique** : le résultat à pleine taille ;
- **Chiffres** : le même résultat en tableau ;
- **Lignes** : pour une question assistée, les lignes derrière le résultat — les conversations,
  les messages… —, 500 au plus.

Un clic sur un **point** d’un graphique — une barre, une part, un point d’une courbe —, ou sur
une valeur d’un tableau regroupé, ouvre un menu :

- **Voir ces lignes** ouvre le détail sur les lignes de ce point seulement : « Commencée le :
  2 oct. », « Statut : Résolue ». Chaque condition est une pastille qu’on retire d’un clic ;
- **Filtrer le tableau** donne cette valeur au filtre du tableau lié à la carte sur cette
  colonne — une boîte, un site —, quand il y en a un.

Une question en SQL n’a pas de lignes à montrer : son détail s’arrête au graphique et aux
chiffres.

## Les filtres

Au-dessus des cartes, chaque filtre est un contrôle :

| Sorte | Ce qu’on choisit |
|---|---|
| **Période** | aujourd’hui, les 7, 30 ou 90 derniers jours, les 12 derniers mois, toute la période, ou deux dates |
| **Valeurs à choisir** | une ou plusieurs valeurs d’une colonne — les boîtes, les sites, les conseillers, les statuts… —, lues dans les données |
| **Texte** | des mots qu’une colonne doit contenir |

Un filtre ne s’applique qu’aux cartes qui lui sont **liées**, sur une colonne de leur question :
une période sur une date, des valeurs ou un texte sur une colonne de texte. Choisi, il **remplace**
ce que la carte filtre elle-même sur cette colonne : une carte enregistrée sur 30 jours montre 90
jours quand la période dit 90. Une carte qui n’est pas liée ne bouge pas. Une question en SQL ne
suit pas les filtres.

Chacun garde ses choix dans son navigateur, tableau par tableau ; un tableau rouvert reprend ses
derniers choix, ou la valeur que le filtre a à l’ouverture.

## Modifier un tableau

Un superviseur clique sur **Modifier** :

- les cartes se déplacent et se redimensionnent à la souris ;
- **Question** ouvre l’éditeur de question, **Titre** ajoute un titre de section, **Texte** une
  carte de texte ;
- le titre d’une carte et celui d’une section se modifient sur place ;
- le menu d’une carte la modifie (**Modifier la question**), la duplique (**Dupliquer**) ou la
  retire (**Retirer la carte**) ;
- **Filtre**, au bout de la barre des filtres, en ajoute un ; le crayon à côté d’un filtre le
  modifie ou le retire (**Retirer le filtre**). Son éditeur liste les **graphiques filtrés** : un
  interrupteur par carte, et la colonne visée. Un nouveau filtre se lie d’office aux cartes qui ont
  la colonne — leur date pour une période — ; on délie celles qu’il ne doit pas filtrer. Une
  carte ajoutée ensuite suit, de même, les filtres dont elle a la colonne ;
- en mode modification, une carte montre combien de filtres elle suit ;
- le tableau prend un nom ; **Visible des conseillers** l’ouvre à tous ;
- **Enregistrer** garde le tout, **Annuler** y renonce ; **Supprimer le tableau de bord** est
  sous **Autres actions**.

**Nouveau tableau de bord** est dans le menu qui choisit le tableau, en haut de l’écran. Un
tableau compte quarante cartes au plus.

## Une question assistée

L’onglet **Assistée** compose une question sans écrire de SQL, comme le carnet de basedb : des
étapes l’une sous l’autre, chacune de sa couleur, chaque choix une pastille qui s’ouvre là où on
le change, et qu’une croix retire.

| Étape | Ce qu’on y choisit |
|---|---|
| **Données** (bleu) | la source : conversations, messages, appels à l’IA, avis sur l’IA, étiquettes, contacts, exécutions d’automatisations |
| **Filtre** (violet) | des conditions sur les colonnes : est, n’est pas, contient, est vide ; après, avant, entre ; **dans les derniers** N jours, semaines ou mois ; oui ou non. Pour « est », les valeurs de la colonne se cochent |
| **Résumer… par…** (vert) | un ou plusieurs calculs — nombre de lignes, nombre de valeurs distinctes, somme, moyenne, médiane, minimum, maximum, part des « oui » (%) — par un ou deux regroupements ; une date se groupe par heure, jour, semaine, mois, année, jour de la semaine ou heure de la journée |
| **Trier**, **Limiter** | l’ordre, qu’un clic inverse, et le nombre de lignes |

Au-dessus du résultat se choisissent le graphique et l’unité. Une **Tendance** dit si une baisse
est une bonne nouvelle (un délai, un transfert) ; un **Objectif** prend sa valeur et son nom.

Une nouvelle question part des trente derniers jours, comptés jour par jour : un graphique
s’affiche aussitôt, et suit chaque changement. Les dates se lisent au fuseau horaire du
lecteur.

La question est traduite en SQL par le serveur, chaque nom de colonne pris dans la liste des
sources, chaque valeur passée en paramètre : rien de ce qu’on choisit ne devient du code.

### Les sources

Chaque source est une vue du schéma `analytics`, jamais une table de la messagerie. Ses colonnes
ont un libellé en français.

| Source | Une ligne par… | Quelques colonnes |
|---|---|---|
| **Conversations** | conversation | commencée le, statut, boîte, équipe, site, canal (widget, SMS, RCS), priorité, humeur, conseiller, client identifié, pays, l’IA a répondu, transférée par l’IA, résolue par l’IA, première réponse (s), messages |
| **Messages** | message | envoyé le, auteur (visiteur, IA, conseiller, système), type (message, note, fichier, transfert), conseiller, boîte, supprimé |
| **Appels à l’IA** | appel au modèle | le, raison (réponse, suggestion, étiquettes, résumé, reformulation, pièce jointe, voix, automatisation), modèle, confiance, durée, jetons lus et écrits |
| **Avis sur l’IA** | avis d’un conseiller | le, avis (acceptée, modifiée, rejetée), conseiller, sur |
| **Étiquettes** | étiquette posée | étiquette, posée par (conseiller, IA), posée le, boîte |
| **Contacts** | contact | venu le, client identifié, pays, segment, a laissé son e-mail |
| **Exécutions d’automatisations** | exécution | le, automatisation, déclencheur, statut, durée |

**Résolue par l’IA** : l’IA a répondu, sans transfert, et sans qu’un conseiller écrive au
visiteur. **Première réponse** : le délai entre le premier message du visiteur et la première
réponse, de l’IA ou d’un conseiller.

## Une question en SQL

L’onglet **SQL** prend une requête écrite à la main :

```sql
select date_trunc('week', created_at) as semaine,
       avg(first_response_seconds) as premiere_reponse
from conversations
where created_at > now() - interval '90 days'
group by 1
order by 1
```

- **Un seul `SELECT`**, sur les vues du schéma `analytics` — les noms des vues suffisent. **Les
  colonnes des vues**, à côté de la requête, les rappellent.
- **En lecture seule**, dans une transaction qui ne peut rien écrire, quinze secondes au plus :
  « La question a pris plus de quinze secondes : resserrez-la. »
- **Sous le rôle `chat_analytics`**, qui lit ces vues et rien d’autre : ni les comptes, ni les
  sessions, ni les secrets, ni les tables de la messagerie.
- **Une seule instruction** : une requête qui en enchaîne deux est refusée avant de s’exécuter.

### Demander à l’IA

**Demander à l’IA** écrit la requête d’une phrase — « les conversations transférées par
semaine, par boîte » —, choisit le graphique et le titre, puis **l’essaie avant de la
proposer** : si elle échoue, l’IA la corrige une fois. La requête proposée se relit et se
modifie comme une autre. Il faut un modèle d’IA sur le serveur (`CHAT_AI_API_KEY`).

### Quand le SQL est indisponible

Le serveur crée le rôle `chat_analytics` à sa migration. Si l’utilisateur de la base n’a pas le
droit de créer un rôle — une base hébergée aux droits restreints, par exemple —, les questions
en SQL sont refusées : « Les questions en SQL sont
indisponibles : la base refuse le rôle de lecture (chat_analytics). » Les questions assistées,
elles, fonctionnent toujours.

Avec le `docker compose` du dépôt et celui de la
[mise en production](/messagerie/hebergement/production/), l’utilisateur de la base peut créer
le rôle : rien à faire.
