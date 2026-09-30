# 00. Décisions structurantes

Ce chapitre fixe les décisions dont dépend le reste du produit. Il fait autorité : en
cas de divergence avec un autre document, celui-ci l'emporte et l'autre doit être
corrigé. Chaque décision porte un numéro stable, que le code et les autres chapitres
citent (`D1`, `D4`…).

Point de départ : le cadrage « Messagerie client IA » du 29 septembre 2026. Il visait
une messagerie développée en interne. Le produit
devient un logiciel libre, frère de basedb, qui s'appuie sur basedb pour tout ce qui se
paramètre.

---

## Le produit en trois parties

| Partie | Pour qui | Où |
|---|---|---|
| **Le widget** | Les visiteurs d'un site | Un script à coller dans le site (`apps/widget`) |
| **L'inbox** | Les conseillers | Une application web dans le style de basedb (`apps/web`) |
| **Le paramétrage** | Les administrateurs | basedb, base « Messagerie » |

S'y ajoute une partie que personne ne voit : **le serveur du chat** (`apps/server`). Il
porte l'API temps réel, l'IA et les tâches de fond.

---

## D1 — Deux familles de données, un seul PostgreSQL

**basedb tient le paramétrage et le référentiel.** Il est rangé dans une base
« Messagerie », créée par le modèle `packages/basedb-template/messagerie.json` :

- sites (domaines autorisés, widget, seuil de confiance, conservation) ;
- horaires d'ouverture ;
- équipes et conseillers ;
- réponses types, étiquettes ;
- catégories, articles, conversations promues ;
- garde-fous, outils IA.

**Le serveur du chat tient le flux**, dans son propre schéma `chat` :

- contacts, conversations, messages ;
- `ai_runs`, `ai_feedback` ;
- `kb_chunks` et leurs vecteurs ;
- métadonnées des pièces jointes, file de tâches, journal des accès.

Les deux vivent dans la même instance PostgreSQL. Le flux ne passe pas par basedb, pour
quatre raisons :

- **Latence.** Un chat demande un WebSocket qui répond en moins de 100 ms.
- **Maîtrise du schéma.** Le chat fait évoluer ses tables chaudes par ses propres
  migrations : index, pgvector. basedb interdit tout DDL hors de son catalogue.
- **Suppressions.** La rétention RGPD impose des purges, et un jeton d'intégration
  basedb ne supprime jamais.
- **Volume.** Chaque message ajouterait une révision d'historique dans basedb.

## D2 — Le chat lit basedb par son API publique, jamais par ses tables

Le serveur du chat lit la base « Messagerie » avec le SDK de basedb (licence MIT). Il
utilise un jeton d'intégration limité à cette base, en lecture seule, et une écriture
seulement pour promouvoir une conversation. Il ne lit jamais les tables `b_…` en SQL :
leurs noms physiques sont un détail interne de basedb.

Le paramétrage est mis en cache par le serveur du chat. basedb le prévient de chaque
changement (dépendance B3). En attendant, le chat relit les lignes par `_updated_at`,
ce qui reste bon marché sur des tables de quelques dizaines de lignes.

Le sens inverse est permis : des vues SQL de basedb peuvent lire le schéma `chat` pour
ses tableaux de bord. C'est ainsi que viendront les statistiques complètes.

## D3 — L'installation crée la base « Messagerie » en une opération

Au premier démarrage, le serveur du chat demande à basedb d'appliquer le modèle
`messagerie.json` côté serveur, en une seule opération (dépendance B1). Le modèle est
versionné avec le chat. `pnpm template:check` le fait passer au validateur de basedb,
le même que celui de son serveur.

Question ouverte : faire évoluer une base déjà créée quand le modèle change (un champ
ajouté dans une version du chat). Il faudra une étape de migration du chat, qui passe
par l'API d'administration de basedb.

## D4 — Les conseillers sont des comptes basedb

Un conseiller se connecte avec son compte basedb : le chat vérifie l'identité auprès de
basedb (dépendance B2). Le SSO vient donc de la configuration OIDC de basedb, sans
réglage propre au chat.

En attendant B2, la seule identité est celle du développement : `CHAT_DEV_AGENT` désigne
le compte au nom duquel tout se fait, et cette variable est ignorée en production. Là,
faute de savoir qui demande, le serveur refuse tout (`AUTH_NOT_CONFIGURED`) plutôt que de
faire confiance.

Le chat garde une copie des conseillers dans `chat.agent`, pour qu'un message nomme
encore son auteur quand la ligne de basedb a disparu.

- **Être conseiller**, c'est figurer dans la table « Conseillers », case « Actif »
  cochée.
- **Administrer la messagerie**, c'est avoir le droit de modifier la base « Messagerie »
  dans basedb. Les droits par groupe, par table et par champ viennent de basedb.

## D5 — Les visiteurs ne sont jamais des comptes basedb, et les secrets restent au chat

Les contacts vivent dans le schéma `chat`. Un visiteur est anonyme jusqu'à ce que le
site signe son identité (HMAC ou JWT). Le widget n'accepte jamais un identifiant non
signé.

La clé de signature d'un site ne va pas dans basedb : toute personne qui lit la base
« Messagerie » la verrait. Le serveur du chat garde les secrets par site, liés à
l'identifiant de la ligne « Sites ». Il en va de même pour les clés des fournisseurs
d'IA.

## D6 — Un seul canal temps réel, sans Redis

Un seul serveur WebSocket sert le widget et l'inbox. La diffusion entre processus
passe par `LISTEN/NOTIFY` de PostgreSQL. Redis n'entre qu'au passage à plusieurs
instances, et seulement si `LISTEN/NOTIFY` ne suffit plus. C'est la règle A4 de basedb :
PostgreSQL seul.

Le WebSocket ne transporte que des signaux, comme le flux temps réel de basedb. Une
conversation modifiée arrive avec son nouveau résumé. Si son fil est ouvert, l'inbox le
relit par l'API : un seul chemin vers la vérité, quel que soit l'événement. Le signal part
dans la transaction de l'écriture, donc seulement si elle est validée ; un test
d'intégration le vérifie. Un WebSocket échappe au CORS : le serveur refuse toute
ouverture venue d'une autre origine que l'inbox.

## D7 — Tout en TypeScript ; l'IA est un paquet derrière une interface unique

Le cadrage prévoyait un service FastAPI. Le produit reste en TypeScript de bout en
bout, comme basedb : un seul environnement d'exécution à héberger, des types partagés
avec l'inbox.

L'IA vit dans un paquet `packages/ai` :
- une interface LLM unique, avec des fournisseurs interne (compatible OpenAI), européen
  (Mistral) ou autre ;
- le RAG sur pgvector ;
- l'agent et ses outils ;
- le copilote.

Les appels lourds tournent dans le processus de tâches, jamais dans celui du WebSocket.

## D8 — Accès aux données : Drizzle sur le schéma `chat`, pg-boss pour les tâches

Drizzle décrit le schéma `chat` et ses migrations. pg-boss porte les tâches asynchrones
(étiquettes, résumés, indexation, purges de rétention). Les deux ne demandent que
PostgreSQL.

## D9 — Chaque intervention de l'IA est tracée et dite

Chaque appel à l'IA laisse une ligne `ai_runs` : type, modèle, entrées, sortie,
confiance, latence, coût. Les appels sont de quatre types : réponse, suggestion,
étiquette, résumé.

Chaque retour d'un conseiller sur une réponse laisse une ligne `ai_feedback` :
acceptée, modifiée ou rejetée. Ces lignes forment le jeu d'évaluation.

Toute réponse de l'IA est présentée comme telle au visiteur. L'IA n'agit que par les
outils de la table « Outils IA ».

## D9 bis — Le serveur ne rédige pas de phrases

Ce que le serveur enregistre pour être lu par un humain est une donnée, pas une phrase :
- un événement (« a repris la main », un outil appelé) est un objet typé, que l'inbox
  met en phrase avec `$t` dans la langue du lecteur ;
- un refus est un code stable (`EMPTY_MESSAGE`…), que l'inbox traduit par
  `messageFor`.

Seuls les textes écrits par des personnes ou par l'IA sont stockés tels quels.

## D10 — L'interface est celle de basedb

L'inbox reprend les tokens de basedb valeur pour valeur : zinc, un seul accent vert,
bordures plutôt qu'ombres, `text-xs` dense, micro-libellés en capitales. Elle reprend
aussi ses composants shadcn (new-york, Radix, lucide) et ses règles d'écriture :
- tout texte de l'interface en français dans `$t('…')` ;
- le code, ses identifiants et ses commentaires en anglais.

Le vert est réservé à l'action principale et à la sélection. Les statuts utilisent des
pastilles teintées.

Le widget fait exception : il est écrit en Preact dans un Shadow DOM, pour peser
quelques dizaines de Ko sur le site du client. Il reprend la palette, pas les
composants.

## D11 — Licence AGPL-3.0-or-later

Comme basedb. Qui modifie le produit et le propose à des utilisateurs à travers un
réseau leur doit le code source de sa version.

---

## Ce que le chat attend de basedb

| Réf. | Besoin | État |
|---|---|---|
| B1 | Appliquer un modèle côté serveur, en une seule opération | Demandé |
| B2 | Vérifier une identité basedb depuis une autre application | Demandé |
| B3 | Prévenir un serveur interne d'un changement de lignes | Demandé |
| B4 | Des vues SQL basedb qui lisent un schéma que basedb ne gère pas | À vérifier |

## Questions ouvertes

Reprises du cadrage :

- Quel modèle LLM est autorisé, et avec quelles données ?
- Quels sites embarquent le widget au lancement, et leurs clients y sont-ils connectés ?
- Quels outils métier l'agent peut-il appeler en phase 4 ?
- Faut-il le canal e-mail dès le MVP ?
- Quelle durée de conservation impose la conformité ?
- Quel volume à dimensionner (conversations par jour, conseillers simultanés) ?

Nouvelles, nées de ce chapitre :

- Le nom du produit : « Messagerie » est un nom de travail (`apps/web/src/lib/product.ts`).
- L'évolution d'une base « Messagerie » existante quand le modèle change (D3).
