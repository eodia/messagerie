---
title: Base de connaissance
description: L’écran « Connaissances » — catégories, articles rédigés sur place, publication pour l’IA, articles par site, relecture des conversations promues — et ce que la messagerie en fait — découpage en passages, vecteurs dans pgvector.
---

L’IA répond à partir de deux sources : les **articles publiés** et les **conversations
promues**. Les deux vivent dans les tables du paramétrage, dans le schéma `chat` — « Articles »,
« Catégories » et « Conversations promues » (D1, D19). Elles s’écrivent et se relisent dans
l’inbox, sur l’écran **Connaissances** de la barre latérale ; la messagerie les découpe en
passages et les indexe pour que l’IA les retrouve et les cite.

## L’écran « Connaissances »

L’écran se lit de gauche à droite :

- **les rayons** : **Tous les articles**, puis les **Catégories**, chacune avec son compte,
  **Sans catégorie** s’il en reste, et, sous **Appris des conversations**, les **Conversations
  promues**. Au pied, le nombre de passages indexés ;
- **la liste** du rayon choisi, avec **Rechercher dans les articles…** (titre et texte) et
  trois filtres : **Tous**, **Publiés**, **À publier**. Un article publié dit combien de
  passages l’IA en a tirés ;
- **l’article** ouvert, à lire ou à écrire.

**Mode concentration** replie les rayons et la liste pour n’écrire que l’article. L’adresse
suit l’article ouvert : `/connaissance/delai-de-remboursement-a9ce42ba3084`.

Écrire et relire sont réservés aux superviseurs ; les conseillers lisent. Quand le menu en haut
de la barre latérale restreint l’inbox à un site, l’écran montre les articles de ce site et ceux
qui valent pour tous ; un nouvel article y est rattaché.

## Écrire un article

**Nouvel article** crée un brouillon dans la catégorie affichée, avec vous pour auteur, et
sélectionne son titre pour qu’on l’écrive par-dessus. Entrée passe du titre au texte.

L’éditeur écrit le texte comme il se lit. La barre au-dessus donne **Gras**, **Italique**,
**Barré**, **Code** et **Lien** ; en début de ligne, « / » propose les blocs par leur nom :

| Bloc | Pour |
|---|---|
| **Texte** | un paragraphe |
| **Titre** | un sujet : l’IA cite l’article par ses titres |
| **Sous-titre** | une partie d’un sujet |
| **Liste à puces** | des éléments sans ordre |
| **Liste numérotée** | des étapes, dans l’ordre |
| **Citation** | un passage mis en avant |
| **Bloc de code** | du code, ou un texte à recopier tel quel |
| **Séparateur** | une ligne entre deux parties |

Le texte est gardé en Markdown dans le champ « Contenu » : ce que la base garde, et ce que
l’index découpe. À partir de deux titres, un **Sommaire** se dessine dans la marge ; un clic
mène à la section.

Il n’y a pas de bouton pour enregistrer : l’article est enregistré après chaque pause dans la
frappe, et l’en-tête dit **Enregistrement…** puis **Enregistré**. Quitter l’écran enregistre ce
qui restait.

:::tip[Un titre par sujet]
L’index coupe l’article à chaque titre. Un article qui traite trois sujets sous trois titres
donne trois passages, que l’IA cite chacun au bon moment.
:::

## Publier pour l’IA

Un article a l’un de ces statuts, choisis dans la pastille en tête de l’article :

| Statut | L’IA |
|---|---|
| **Brouillon** | ne s’en sert pas tant qu’il n’est pas publié |
| **En révision** | ne s’en sert pas non plus |
| **Publié** | le lit et le cite |
| **Archivé** | ne s’en sert plus |

**Publier** le rend lisible par l’IA et note le jour dans « Relu le » ; **Dépublier** le
ramène en brouillon. Le menu **Plus d’actions** offre **Archiver** et **Supprimer**, qui demande
une confirmation — **Confirmer la suppression** — et efface l’article pour de bon.

Sous le titre d’un article publié, l’inbox dit où en est l’index : **En cours d’indexation pour
l’IA**, puis **Indexé pour l’IA : 4 passages**.

## Pour quels sites

Le bouton **Tous les sites**, en tête de l’article, choisit les sites pour lesquels il vaut
(champ « Sites »). Aucun site coché : l’article vaut pour tous. Quand un visiteur écrit sur un
site, l’IA cherche dans les articles de ce site et dans ceux de tous les sites.

## Catégories

Les catégories rangent les articles (table « Catégories »). **Nouvelle catégorie**, sous la
liste des rayons, en ajoute une ; le bouton de catégorie, en tête de l’article, l’y range. La
catégorie sert à ranger : elle ne change rien à ce que l’IA lit.

Un clic droit sur une catégorie offre **Supprimer**. La messagerie demande ce que deviennent
ses articles : **Garder ses articles** — ils passent dans **Sans catégorie**, et l’IA s’en sert
toujours —, ou **Supprimer aussi ses articles** — l’IA ne s’en sert plus, et rien ne se
récupère. Une catégorie vide part sans question.

## Découpage et vecteurs

Ce que l’IA lit n’est pas l’article entier, mais ses **passages** :

- **un passage par section** : l’article est coupé à chaque titre. Chaque passage porte le
  titre de l’article et celui de sa section ;
- **une section trop longue** — plus de 1 200 caractères — est coupée de nouveau entre deux
  paragraphes, et un paragraphe trop long à la fin d’une phrase ;
- **chaque passage devient un vecteur** de 1024 dimensions, calculé par le modèle
  d’embeddings (`CHAT_AI_EMBEDDING_MODEL`, `mistral-embed` par défaut), et rangé dans le
  schéma `chat` (`chat.kb_chunk`) avec l’extension pgvector.

À chaque message d’un visiteur, la messagerie calcule le vecteur de ce qu’il vient d’écrire et
prend les cinq passages les plus proches, pour son site ([agent IA](/messagerie/fonctionnalites/agent-ia/#comment-elle-répond)).

### L’index suit les articles

Chaque écriture d’un article ou d’une conversation promue prévient tous les processus de la
messagerie, dans sa transaction (D19). L’index se met à jour quelques secondes plus tard, et au
démarrage du serveur :

- seul ce qui a changé est recalculé — le titre, le texte, les sites, ou le modèle
  d’embeddings ;
- ce qui n’est plus publié, ou a été supprimé, quitte l’index : une réponse ne cite jamais un
  article que personne ne peut plus lire.

:::note
L’index demande un modèle d’IA configuré. Sans lui, les articles s’écrivent et se publient,
mais rien n’est indexé.
:::

## Les conversations promues

Une conversation bien résolue peut devenir une source pour l’IA :

1. Dans le fil, le menu **Plus d’actions** offre **Promouvoir en source pour l’IA**, une fois la
   conversation résolue. N’importe quel conseiller peut le faire.
2. L’IA en tire une question type et sa réponse, générales, sans nom, sans numéro, sans donnée
   personnelle — et le texte lui part masqué de toute façon. Sans IA configurée, la ligne
   reprend la première question du visiteur et la dernière réponse, masquées. Elle arrive dans
   la table « Conversations promues », au statut « À relire », avec le lien vers la
   conversation et le nom de qui l’a promue. L’inbox le confirme : « Conversation envoyée à la
   relecture, dans « Connaissances › Conversations promues ». »
3. Un superviseur la relit sur l’écran **Connaissances**, la corrige au besoin, puis la publie
   ou la rejette. Publiée, elle est indexée, pour tous les sites.

### Relire, corriger, publier

Le rayon **Conversations promues** — « Des conversations bien résolues, promues depuis leur
menu ⋯ : relisez-les, puis publiez-les » — les liste toutes, celles **À relire** en tête,
chacune avec sa pastille de statut : **À relire**, **Publiée** ou **Rejetée**. Une conversation
publiée dit combien de passages l’IA en a tirés.

Un clic en ouvre une : sa **Question** et sa **Réponse**, à corriger sur place, et **Voir la
conversation**, qui mène au fil d’origine.

| Bouton | Ce qu’il fait |
|---|---|
| **Enregistrer** | garde la question et la réponse corrigées, sans changer le statut ; paraît dès qu’on a corrigé |
| **Publier** | les garde et passe la conversation à « Publiée » : l’IA s’en sert. Grisé tant que la question ou la réponse est vide |
| **Rejeter** | les garde et passe la conversation à « Rejetée » : l’IA ne s’en sert pas, ou plus |

Une conversation publiée peut encore être rejetée, une rejetée publiée. Un conseiller lit la
liste, sans les boutons.

Dans les sources d’une réponse de l’IA, une conversation promue paraît avec la pastille
**Relue**.
