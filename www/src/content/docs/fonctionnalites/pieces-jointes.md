---
title: Pièces jointes
description: Les fichiers échangés dans une conversation, où ils sont gardés, comment ils se lisent, et l’IA qui les lit à la demande d’un conseiller.
---

Un visiteur joint des fichiers depuis le [widget](/messagerie/fonctionnalites/widget/) — une
photo du sinistre, une facture, une attestation. Un conseiller en joint depuis l’inbox, à une
réponse ou à une note. Le texte est alors facultatif : un message peut n’être fait que de
fichiers.

## Joindre

**Dans le widget**, le visiteur :

- clique sur le trombone (**Joindre un fichier**) ;
- glisse ses fichiers sur le champ du message (« Déposez vos fichiers ici ») ;
- ou colle une image, par exemple une capture d’écran.

Les fichiers attendent sous le champ, avec leur miniature, jusqu’à l’envoi ; chacun se retire
d’un clic.

**Dans l’inbox**, le conseiller fait de même dans le composeur : le trombone (**Joindre des
fichiers**), un glisser-déposer (« Déposez les fichiers ici ») ou une image collée. Joints à une
**Note interne**, les fichiers restent dans l’équipe, comme la note : le visiteur ne les voit
pas.

## Ce qui est pris

| | |
|---|---|
| Images | PNG, JPEG, GIF, WebP |
| Documents | PDF, Word (`.docx`), Excel (`.xlsx`) |
| Textes | `.txt`, `.csv`, `.md`, `.log` |
| Taille | 10 Mo par fichier |
| Nombre | cinq par message |

**Le type se décide sur les octets**, pas sur le nom du fichier ni sur le type qu’annonce le
navigateur : une image doit commencer comme une image, un PDF comme un PDF. Un document Word ou
Excel est une archive zip, dont l’extension dit lequel. Un texte ne contient aucun octet nul dans
ses premiers kilo-octets, et porte une extension de texte. Tout le reste est refusé, un fichier
vide aussi.

Un fichier refusé l’est avant l’envoi quand c’est possible — « Fichier refusé : images, PDF ou
documents, 10 Mo au plus. » dans le widget —, et sinon par le serveur, qui refuse alors tout le
message.

Le nom du fichier est gardé pour l’affichage, débarrassé de tout chemin et de tout caractère de
contrôle, 120 caractères au plus. Il ne sert jamais à ranger le fichier.

## Où ils sont gardés

**Les octets ne vont pas dans la base de données.** Ils vont dans un dossier du
serveur, `CHAT_FILES_DIR` (`.files` par défaut, à partir du dossier où le serveur est lancé), un
sous-dossier par conversation, un fichier par pièce jointe, nommé par son identifiant.

La table `chat.attachment` garde le nom, le type, la taille et l’emplacement de chaque fichier,
et ce qu’en a dit l’IA. Le fichier est écrit avant le message ; si l’écriture du message échoue,
il est retiré : aucun fichier ne reste sans sa ligne.

:::caution[Sauvegardes]
Le dossier `CHAT_FILES_DIR` se sauvegarde avec la base : l’un sans l’autre laisse des pièces
jointes sans fichier, ou des fichiers que plus rien ne cite.
:::

## Comment ils se lisent

Un fichier se lit par **un lien signé** par le serveur :
`/files/<identifiant>?e=<échéance>&s=<signature>`. La signature est un HMAC-SHA256 tiré de
`CHAT_SECRET`, et le lien vaut un jour. Le widget et l’inbox le mettent tel quel dans un `<img>`
ou un lien, sans jeton : chaque lecture de la conversation donne des liens neufs, et un lien
copié ailleurs cesse de fonctionner le lendemain.

Le serveur les sert sans rien qui s’exécute :

- les images et les PDF s’ouvrent dans le navigateur, le reste se télécharge ;
- le type est celui que le serveur a reconnu, avec `X-Content-Type-Options: nosniff` ;
- une politique de sécurité du contenu y interdit tout script, et met dans un bac à sable tout
  ce qui n’est pas un PDF.

Dans le widget, une image s’affiche en vignette qui s’ouvre en grand ; un autre fichier, en
carte avec son nom et sa taille. Dans l’inbox, de même, avec le genre du fichier (PDF, DOCX…).

Changer `CHAT_SECRET` rend caducs tous les liens déjà donnés — et les jetons des visiteurs.

## La purge de rétention

Chaque site règle sa durée de conservation : **Administration › Sites et horaires**, onglet
**Sites**, section **Conservation**, **Purger les conversations après**. Chaque nuit, le
processus des tâches supprime les conversations de ce site sans message depuis plus longtemps,
**avec leurs pièces jointes** : les lignes, et le dossier de la conversation dans
`CHAT_FILES_DIR`. Partent avec elles leurs messages, leurs traces d’IA et les extraits indexés
pour l’IA, puis les contacts qui n’ont plus de conversation.

## Analyser avec l’IA

**L’IA lit un fichier quand un conseiller le demande, jamais parce qu’il est arrivé.** Sous une
image, un PDF ou un texte, le bouton **Analyser avec l’IA** l’envoie au modèle — son infobulle le
dit avant le clic : « Le fichier est envoyé au modèle d’IA de la messagerie, qui le décrit. »

| Fichier | Lu par |
|---|---|
| Image | le modèle de vision : `CHAT_AI_VISION_MODEL`, ou à défaut le modèle de la messagerie (`CHAT_AI_MODEL`, Mistral Small par défaut, qui lit les images) |
| PDF | l’OCR du fournisseur : `CHAT_AI_OCR_MODEL`, `mistral-ocr-latest` par défaut chez Mistral, aucun ailleurs (`off` pour s’en passer) |
| Texte | tel quel, ses 30 000 premiers caractères |

Un document Word ou Excel ne s’analyse pas : le bouton n’y paraît pas.

Ce que l’IA en dit tient en quelques puces : de quoi il s’agit, les informations qui comptent pour
la demande — dates, montants, références, noms, dommages visibles —, ce qui manque ou paraît
illisible, et au besoin une ligne « À vérifier : … ». L’analyse reste **sous le fichier, pour
toute l’équipe**, avec qui l’a demandée et quand (**Lu par l’IA**, « Demandée par Camille ·
14:32 »), et se copie d’un clic. Le visiteur ne la voit jamais.

- **Données personnelles.** Quand le modèle est hébergé hors de chez vous, un texte est masqué
  avant de partir, comme tout ce que lit l’IA (`CHAT_AI_REDACT`). Une image ou un PDF ne se
  masquent pas : c’est pourquoi l’inbox dit où part le fichier avant qu’on le demande.
- **Traçabilité.** Chaque analyse laisse une trace, comme tout appel à un modèle : une ligne
  `chat.ai_run` de genre `attachment`, avec le modèle, la façon dont le fichier a été lu, le
  conseiller qui l’a demandée, la durée et les jetons consommés.
- **Refus.** Sans modèle configuré, l’analyse est refusée. Un PDF sans OCR, ou une image que le
  modèle ne sait pas lire, l’est aussi : « L’IA ne sait pas lire ce fichier avec le modèle
  configuré (images, PDF et textes seulement). »

## Ce que l’agent IA en sait

L’[agent IA](/messagerie/fonctionnalites/agent-ia/) **sait qu’un fichier a été joint** : dans
l’historique qu’il lit, chaque pièce est nommée avec son type, suivie de ce qu’en a dit l’analyse
si un conseiller l’a demandée, ou de « pas encore lue ». Il ne lit pas le fichier lui-même : un
visiteur qui envoie une photo n’envoie rien au modèle tant qu’un conseiller ne l’a pas décidé.

## Emoji et GIF

**Le widget** propose une cinquantaine d’emoji d’un clic, choisis pour un service client. **L’inbox**
les propose tous, cherchés par leur nom en français, avec leurs tons de peau, les derniers choisis
en tête. Ni l’un ni l’autre ne charge de bibliothèque d’images : le système les dessine.

**Les GIF** sont réservés aux conseillers, dans l’onglet **GIF** du même sélecteur, quand le
serveur a une clé GIPHY (`GIPHY_API_KEY`). La recherche passe par le serveur, qui garde la clé ;
le GIF choisi est téléchargé par le serveur puis joint au message comme une image. La page du
visiteur ne demande jamais rien à GIPHY.
