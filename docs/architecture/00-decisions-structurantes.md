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

basedb 0.5.0 applique un modèle côté serveur, en une seule opération (B1) :
`POST /api/v1/<tenant>/admin/bases {"template": …, "label": …, "rows": …}`, avec le jeton
d'accès d'un administrateur, et les étapes en NDJSON à la demande.

`pnpm --filter @chat/server provision` le fait avec `messagerie.json`. Il prend le jeton
d'un administrateur (`BASEDB_ADMIN_TOKEN`), ou son adresse et son mot de passe, avec
lesquels il se connecte comme le fait l'interface. Les lignes du modèle sont écrites par
défaut : ce sont les réglages de départ (un site, une équipe, les garde-fous), et elles
font de celui qui lance la commande le premier superviseur. `--no-rows` les omet.

Reste à créer, dans basedb, un jeton d'intégration de la base pour la surface REST, **en
écriture**, puis à le donner au serveur (`BASEDB_BASE`, `BASEDB_TOKEN`). L'écriture sert à
promouvoir une conversation ; le paramétrage, lui, écrit avec le jeton du superviseur
(D10).

En développement, `docker compose` fait tourner un basedb dédié au chat (basedb 0.5.0,
http://localhost:8890), dans une base de données à lui du même PostgreSQL.
`pnpm db:up` écrit d'abord `.env` : la clé de chiffrement et l'administrateur, générés, ne
sont jamais dans le fichier compose. `pnpm basedb:setup` se connecte en administrateur,
crée la base avec les lignes d'Acme Assurances si elle n'existe pas, émet le jeton du chat
s'il n'en a pas de bon, et écrit la configuration du serveur et de l'inbox. Relancé, il ne
change rien de ce qui marche.
`pnpm template:check` fait passer le modèle au validateur de basedb, celui-là même que
son serveur applique.

Quand le modèle gagne un champ dans une version du chat, `pnpm basedb:setup` l'ajoute à
la base existante, par l'API d'administration de basedb : ajout seulement, jamais de
suppression, de renommage ni de changement de genre, qui restent une décision prise dans
basedb. Une relation, un calcul ou une table entière qui manquent sont signalés, pas
créés. Le serveur relit la description de la base quand il écrit un champ qu'il ne lui
connaissait pas.

## D4 — Les conseillers sont des comptes basedb

Un conseiller se connecte avec son compte basedb. La mire de l'inbox ne fait que relayer
la connexion de basedb (`POST /auth/password/login`) : basedb dépose ses cookies de session
pour l'hôte, et l'inbox et basedb partagent dès lors une seule session. La déconnexion de
l'une vaut pour l'autre. Un compte que basedb a créé avec un mot de passe temporaire choisit
le sien dans la mire, comme l'interface de basedb le demande (`/auth/password/change`). Les
boutons de SSO de basedb n'y paraissent que si l'inbox est servie à l'adresse de basedb :
basedb ne renvoie une connexion SSO que vers ses propres chemins.

Ensuite, l'inbox demande à la session basedb du navigateur un jeton d'accès (`POST /auth/session/access`, avec le cookie de session et,
dans `X-Basedb-Csrf`, la valeur du cookie CSRF). Elle l'envoie au serveur du chat, qui
demande à basedb ce qu'il vaut (introspection RFC 7662, B2). Le SSO vient donc de la
configuration OIDC de basedb, sans réglage propre au chat.

- **Être conseiller**, c'est figurer dans la table « Conseillers », avec son compte basedb
  et la case « Actif » cochée. Le rôle « Superviseur » y est lu.
- **Administrer la messagerie**, c'est avoir le droit de modifier la base « Messagerie »
  dans basedb. Les droits par groupe, par table et par champ viennent de basedb.
  `pnpm basedb:setup` crée le groupe « Superviseurs de la messagerie », qui peut modifier
  la base (`BASEDB_SUPERVISORS_GROUP`). Un conseiller nommé superviseur dans l'inbox y
  entre, et en sort quand il redevient conseiller.
- **Inviter un conseiller** se fait dans l'inbox : son compte basedb est créé avec lui, son
  mot de passe temporaire s'affiche une fois, et il choisit le sien à la première
  connexion. Une adresse qui a déjà un compte le garde. Créer un compte, redonner un mot de
  passe ou changer un rôle demande à basedb un administrateur qui a confirmé son mot de
  passe dans les cinq minutes : l'inbox le redemande quand basedb l'exige.
- **Un jeton d'intégration n'est pas un conseiller** : un programme ne répond pas aux
  visiteurs.
- **Réponse gardée 30 secondes au plus**, jamais au-delà de l'échéance du jeton. C'est la
  même fenêtre de révocation que basedb.
- **« Conseillers » gardée jusqu'au prochain signal.** Le serveur relit la table quand
  basedb signale un changement, sur son flux SSE ouvert aux jetons d'intégration (B3).
- **Copie locale.** Le chat garde une copie des conseillers dans `chat.agent`, pour qu'un
  message nomme encore son auteur quand la ligne de basedb a disparu.

**Contrainte de déploiement : l'inbox est servie sur le même hôte que basedb.** Le cookie
CSRF de basedb n'est lisible que par les scripts de son hôte. C'est voulu : aucune autre
origine ne doit pouvoir obtenir un jeton. L'inbox vit donc sous un autre chemin du même
hôte, derrière la même passerelle (`https://support.exemple.fr/` pour l'inbox,
`/basedb/` pour basedb). En développement, `localhost` suffit, car les cookies ignorent
les ports : le basedb de `docker compose` (http://localhost:8890) et l'inbox
(http://localhost:3210) partagent la session. Pour lever cette contrainte, il faudrait un transfert de jeton explicite fourni
par basedb, par exemple un lien « Ouvrir la messagerie » qui le remet à l'inbox.

**Le WebSocket s'ouvre par ticket.** Un navigateur ne peut pas y mettre d'en-tête
`Authorization`, et un jeton dans l'URL finit dans les journaux. L'inbox demande donc un
ticket par HTTP authentifié : il vaut une fois, pendant trente secondes.

Sans basedb configuré, et en développement seulement, `CHAT_DEV_AGENT` désigne le compte
au nom duquel se font les requêtes sans jeton. En production, une requête sans jeton est
refusée.

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

« Quelqu'un écrit » est le seul signal qui n'accompagne aucune écriture : rien n'est
stocké, le signal part hors transaction. Le widget le dit par son WebSocket, l'inbox par
`POST …/typing`, au plus toutes les deux secondes chacun. Les conseillers qui voient la
boîte de la conversation l'apprennent, et seulement eux ; le visiteur voit les trois points
avec le prénom du conseiller. Sans nouvelle frappe, l'indication s'éteint en quelques
secondes. Le texte en cours de frappe, lui, ne quitte jamais le navigateur.

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

## D9 ter — Les alertes : le serveur dit pourquoi, l'inbox décide pour qui

**Côté serveur.** Chaque écriture qui appelle un conseiller le dit dans son signal : un
visiteur a écrit (`visitor_message`), l'IA a transféré (`handoff`), quelqu'un a confié la
conversation (`assigned`). Dans la même transaction, elle écrit une ligne dans la cloche
de chaque conseiller concerné (`chat.notification`) :
- **un message de visiteur** va à celui qui a la conversation. Personne n'est appelé tant
  que l'IA répond ;
- **un transfert** va à l'affecté, ou à tous les conseillers actifs s'il n'y en a pas ;
- **une affectation** va à celui qui la reçoit, sauf s'il se l'est donnée lui-même.

Une seule ligne non lue par conseiller, conversation et cause : un visiteur qui écrit cinq
fois sonne cinq fois, mais laisse une ligne, remontée en tête. Ouvrir la conversation lit
ses lignes. Les onglets ouverts de ce conseiller reçoivent un signal « relisez vos
notifications ».

**Côté inbox.** Une alerte concerne le lecteur si la conversation est la sienne, ou si
elle attend dans la file sans affecté. Alors :
- un son, synthétisé (deux notes pour un message, trois pour ce qu'on lui confie) ;
- une notification du bureau si l'onglet n'est pas au premier plan, une seule par
  conversation ;
- rien s'il a déjà la conversation sous les yeux : elle est marquée lue.

Les pastilles — le compteur de l'onglet, le point sur son icône, la barre latérale —
comptent ce qui attend le lecteur : les conversations non lues qui sont les siennes ou
dans la file. La cloche compte ses lignes non lues. Le son et les notifications du bureau
se règlent par navigateur, dans le menu du compte.

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

### Le paramétrage se fait dans l'inbox ; ses données restent dans basedb

Un superviseur règle la messagerie sans quitter l'inbox. La section « Paramétrage » du
menu ouvre les écrans des boîtes de réception, des équipes et des conseillers, des sites et
de leurs horaires, des réponses types et des étiquettes, des garde-fous, des outils de l'IA
et des serveurs MCP, des articles, et du widget.

Chaque écran est bâti comme l'éditeur du widget : les lignes à gauche, le formulaire au
milieu, et à droite ce que le réglage change, dessiné en direct — la boîte dans le menu et
le chemin d'une conversation, la semaine d'ouverture, la réponse type dans le composeur,
le garde-fou qui se déclenche, l'outil tel que l'IA le lit et la requête qu'il envoie. Les
changements restent des brouillons, ligne par ligne, jusqu'à « Enregistrer » (ou Ctrl+S).

Ces écrans ne copient rien : ils lisent et écrivent les tables de la base « Messagerie »
par l'API de basedb (D2). Les champs, leurs genres, leurs choix et leurs relations sont
ceux que déclare `messagerie.json` : un champ ajouté au modèle que l'écran ne range pas
encore apparaît sous « Autres réglages ».
Le serveur vérifie chaque valeur contre le modèle, puis écrit dans basedb **avec le jeton
du superviseur** : basedb applique ses droits, et l'historique de la ligne porte son nom.
basedb réserve la suppression d'une ligne à ses administrateurs. Sans basedb, en
démonstration, les lignes du modèle changent en mémoire jusqu'au redémarrage.

basedb reste ouvert à qui veut ses grilles, ses vues, ses formulaires ou ses droits fins :
le menu garde son lien. Rien de courant ne demande plus de s'y rendre.

### L'éditeur du widget

L'apparence du widget se règle mieux en le voyant. L'écran « Widget » règle couleur,
thème, coins, police, logo, côté et marges, bouton rond ou avec libellé, titre et
sous-titre d'accueil, message d'accueil, questions suggérées, bulle d'accueil, masquages
et mention du logiciel. À côté, le vrai widget tourne en mode aperçu, dans une page que le
serveur sert (`/widget/preview`, encadrable par l'inbox seule). L'éditeur lui envoie le
brouillon par `postMessage`, et le widget n'appelle alors jamais le serveur. Ces réglages
sont des colonnes de la table « Sites ».

Le widget ne charge aucune police sur le site d'un client : « Police du site » reprend
celle de la page, « Personnalisée » nomme une police que la page charge déjà. Un nom de
police, un logo qui n'est pas en https, une marge hors bornes sont lus comme vides, qu'ils
viennent de l'éditeur ou d'une saisie directe dans basedb.

## D11 — Licence AGPL-3.0-or-later

Comme basedb. Qui modifie le produit et le propose à des utilisateurs à travers un
réseau leur doit le code source de sa version.

## D12 — Les boîtes de réception, distinctes des équipes

Une **boîte de réception** dit où arrivent les conversations ; une **équipe**, qui y
répond. Une même équipe peut servir plusieurs boîtes.

Dans la base « Messagerie », la table « Boîtes de réception » nomme les équipes qui
répondent dans chaque boîte et son équipe par défaut. Un site nomme la boîte où arrivent
ses conversations ; sans cela, elles vont dans la première boîte active.

Une nouvelle conversation reçoit la boîte de son site et l'équipe par défaut de cette
boîte, ou à défaut celle du site.

- **Visibilité.** Un superviseur voit toutes les boîtes. Un conseiller voit les boîtes
  qu'une de ses équipes sert (« Conseillers » › Équipes). La règle vaut pour la liste, le
  fil, les signaux temps réel et les cloches. Une conversation d'avant les boîtes est à
  tous.
- **Transfert.** Une conversation passe à une autre boîte, à une autre équipe de sa boîte,
  ou les deux, avec une note facultative. Elle revient dans la file de l'équipe qui la
  reçoit, qui en est prévenue. Elle quitte la personne qui l'avait, et l'IA.
- **Transfert par l'IA.** L'IA transfère à l'équipe d'un garde-fou, ou à celle de la
  conversation. Seuls les membres de cette équipe sont prévenus, avec les superviseurs.
- **Apparence.** Une boîte a une couleur, et un pictogramme ou une petite image, comme une
  base ou une table dans basedb. Le sélecteur est celui de basedb, repris tel quel
  (`look-picker`), avec sa bibliothèque de pictogrammes Lucide : le même nom (`shield-alert`)
  vaut des deux côtés. Une image est réduite à 64 pixels dans le navigateur ; le serveur ne
  laisse passer qu'une adresse https ou une image matricielle intégrée, jamais un script.

## D13 — Les métadonnées, et ce que la page peut dire au widget

Une page peut joindre des métadonnées au contact ou à la conversation : un numéro de
commande, un panier, la page lue. Un conseiller peut aussi en ajouter. Ce sont des clés
libres aux valeurs courtes (texte, nombre, oui ou non), rangées dans le schéma `chat`
(`contact.data`, `conversation.data`).

Rien n'en est vérifié. L'inbox le dit là où elle les montre, et l'IA les reçoit comme des
données déclarées, jamais comme une preuve ni comme une consigne. Un client que le site a
signé (D5) garde le nom et l'e-mail de sa signature : un script de la page ne peut pas le
renommer.

La page parle au widget par `window.MessagerieChat` :
- ouvrir, fermer, montrer ou cacher le widget ;
- préremplir ou envoyer un message ;
- dire qui est un visiteur anonyme ;
- joindre des métadonnées ;
- écouter les événements.

Les appels faits avant le chargement du script attendent dans une file. Les métadonnées
de conversation fixées avant le premier message partent avec lui, et l'IA les lit dès sa
première réponse.

## D14 — Les pièces jointes, et l'IA qui les lit sur demande

Un visiteur joint des fichiers depuis le widget, un conseiller depuis l'inbox, à une
réponse ou à une note : le trombone, un glisser-déposer, ou une image collée. Le texte est
alors facultatif. Le widget et l'inbox ont aussi leur palette d'emoji, sans bibliothèque :
le système les dessine.

- **Ce qui est pris** se décide sur les octets, pas sur le nom ni le type annoncé : images
  (PNG, JPEG, GIF, WebP), PDF, textes (TXT, CSV, MD), Word et Excel. 10 Mo par fichier,
  cinq par message.
- **Où ils vont** : les octets dans un dossier du serveur (`CHAT_FILES_DIR`, `.files` par
  défaut), jamais dans la base ni dans basedb ; la table `chat.attachment` garde le nom,
  le type, la taille et la clé. La purge de rétention emporte le dossier de la
  conversation avec elle.
- **Comment ils se lisent** : par un lien signé par le serveur (HMAC, valable un jour),
  que l'inbox et le widget mettent dans un `<img>` sans jeton. Servis avec `nosniff`, en
  pièce jointe sauf les images et les PDF, et sans rien qui s'exécute.
- **L'IA lit un fichier quand un conseiller le demande**, jamais parce qu'il est arrivé :
  « Analyser avec l'IA » sous le fichier. Une image va au modèle de vision
  (`CHAT_AI_VISION_MODEL`, le modèle par défaut sinon — Mistral Small lit les images), un
  PDF à l'OCR du fournisseur (`mistral-ocr-latest` chez Mistral, `CHAT_AI_OCR_MODEL`), un
  texte tel quel, masqué si le modèle est externe. Ce qu'elle en dit reste sous le
  fichier pour toute l'équipe, et l'appel est tracé (`ai_run` de genre `attachment`, D9).
  Une image ou un PDF ne se masquent pas : l'inbox dit où part le fichier avant qu'on le
  demande.
- **L'agent IA sait qu'un fichier a été joint** : son contexte nomme chaque pièce, avec ce
  qu'en a dit l'analyse quand elle existe.

## D15 — L'adresse dit où l'on est

Comme dans basedb, l'adresse suit l'écran et l'écran suit l'adresse, en mots lisibles et
en français (`apps/web/src/lib/address.ts`) :

- `/conversations/<boîte>/<conversation>?filtre=ia`, `toutes` pour toutes les boîtes ;
- `/contacts/<contact>`, `/connaissance/<article>`, `/widget/<site>` ;
- `/parametrage/<groupe>/<onglet>/<ligne>`, `/nouveau` pour une ligne pas encore créée,
  et `/outils/<outil>`.

Un élément choisi dans une liste s'écrit par son nom, puis la fin de son identifiant
(`lea-martin-a9ce42ba3084`, douze chiffres hexadécimaux). L'identifiant le retrouve, le nom
ne sert qu'à lire : un visiteur qui a donné son nom depuis est toujours trouvé, et
l'adresse est réécrite avec le nouveau. Les conversations, les articles et les lignes de
paramétrage sont trouvés parmi ceux que l'écran a lus. Un contact est trouvé par le
serveur (`GET /contacts/<mot>`), car l'écran ne les lit pas tous.

L'historique est celui de basedb (`useAddressBar`) :

- un clic ou une touche ouvre une entrée ;
- ce que l'écran choisit de lui-même la remplace (la première conversation, un nom remis
  à jour) ;
- un élément renommé reste la même entrée ;
- précédent et suivant sont suivis après que tous les écouteurs les ont entendus, Next
  compris.

Le titre de l'onglet suit de même, le plus précis d'abord : « (3) Léa Martin — Service
client · Messagerie ».

## D16 — Une API et un serveur MCP, avec des jetons à la basedb

Les services de la Messagerie s'ouvrent aux programmes et aux agents, comme basedb ouvre ses
bases : une API REST, `/api/v1`, et un serveur MCP, `/mcp`, dans le serveur du chat. Les
deux passent par le même service (`apps/server/src/api/service.ts`), qui appelle les mêmes
fonctions que l'inbox : un seul chemin vers les données.

**Les jetons** sont ceux de basedb, pour le chat :

- `msg_<préfixe>_<secret>` : huit caractères gardés en clair pour les distinguer, un secret
  de 32 octets aléatoires en base 62 dont seul le SHA-256 est gardé ;
- lecture, ou lecture et écriture — répondre, noter, affecter, résoudre, étiqueter —,
  jamais de suppression ;
- sur l'API REST, le serveur MCP ou les deux ;
- sur certaines boîtes ou toutes, dans la limite de ce que voit leur créateur ;
- sans expiration ou de 30 jours à un an ; révoqués à l'instant.

Ils se créent dans l'inbox, par un superviseur, et ne s'affichent qu'une fois. Ils restent
dans le schéma `chat`, jamais dans basedb (D5). Un jeton n'atteint pas `/api/inbox` : il ne
gère jamais les jetons. Codes de refus : `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`,
`TOKEN_READ_ONLY`.

**Qui écrit.** Un jeton agit par une ligne de conseiller à lui, jamais active : elle ne
figure dans aucune liste, ne reçoit aucune alerte, et signe ce qu'elle écrit — « Zapier »
dans le fil. Une réponse envoyée par un jeton fait quitter la conversation à l'IA, mais ne
la lui affecte pas : elle reste dans la file.

**Le serveur MCP** suit le transport HTTP « Streamable », en réponses JSON, sans session :
chaque requête vérifie le jeton et ses droits. Ses outils ont des noms anglais et des
descriptions en français, comme ceux de basedb ; un jeton en lecture ne se voit pas
proposer les outils d'écriture. Une requête venue d'une page (en-tête `Origin`) est
refusée. Un refus d'outil est un résultat d'erreur qui porte le code et son sens.

## D17 — Des webhooks à la basedb

L'inverse de D16 : la Messagerie prévient un autre système, dans les secondes, de ce qui se
passe dans les conversations. Le modèle est celui des webhooks de basedb, repris tel quel.

**Capter dans la transaction.** Des déclencheurs PostgreSQL sur `chat.message` et
`chat.conversation` écrivent l'événement (`chat.change_event`) dans la transaction qui fait
la chose : rien ne se perd entre une écriture et son signal, quel que soit le chemin —
inbox, IA, API. Ils ne capturent rien tant qu'aucun webhook n'est actif. L'heure est celle
de l'horloge (`clock_timestamp()`), pas celle du début de la transaction : deux événements
d'une même transaction gardent leur ordre.

**Les événements :** `message.created` (notes comprises), `message.deleted`,
`conversation.created`, `conversation.handed_off`, `conversation.assigned`,
`conversation.transferred`, `conversation.resolved`, `conversation.reopened` — plus
`webhook.ping`, le test envoyé depuis l'écran. Chacun porte la conversation telle que la
liste la donne, et le message s'il y en a un, dans leur état au moment de l'envoi.

**L'envoi** (`apps/server/src/webhooks/dispatch.ts`), toutes les deux secondes, là où
tournent les files (D7) :

- un `POST` signé `X-Messagerie-Signature: t=<s>,v1=<HMAC-SHA256 de "t.corps">`, jusqu'à
  50 événements, délai de 10 s, aucune redirection suivie ;
- dans l'ordre par conversation — une prise à la fois, sous verrou consultatif —, jamais
  globalement ;
- `2xx` livré ; `5xx`, `408`, `429` ou pas de réponse : huit essais, de 10 s à un jour,
  ±20 %, `Retry-After` respecté s'il est plus long ; tout le reste échoue ;
- un envoi pris et jamais conclu se libère au bout de deux minutes : un événement peut
  arriver deux fois, jamais se perdre — le destinataire dédoublonne par `id` ;
- les 50 derniers envois tous en échec arrêtent le webhook (`failures`) ;
- événements gardés 7 jours, envois 90.

**Le secret** (`whsec_…`) signe chaque appel : il est donc scellé (AES-256-GCM, clé tirée
de `CHAT_SECRET` pour ce seul usage), pas haché, et ne s'affiche qu'une fois. Changer
`CHAT_SECRET` rend les secrets illisibles : il faut recréer les webhooks.

**Où appeler.** HTTPS, port 443, adresses publiques seulement : toutes les adresses que
donne le nom sont vérifiées, à la création et avant chaque appel, une IPv4 cachée dans une
IPv6 comprise. `CHAT_WEBHOOK_ALLOW` fait confiance à des noms ou des plages privées ;
`CHAT_WEBHOOK_DEV=1` ouvre HTTP et le réseau local, en développement seulement.

Les webhooks se gèrent dans l'inbox, par un superviseur, dans « Paramétrage › API et MCP »,
onglet « Webhooks » : créer, arrêter, reprendre, supprimer (gardé arrêté, pour son
journal), envoyer un test, lire les derniers envois. Ils restent dans le schéma `chat`,
jamais dans basedb (D5).

---

## Ce que le chat attend de basedb

| Réf. | Besoin | État |
|---|---|---|
| B1 | Appliquer un modèle côté serveur, en une seule opération | basedb 0.5.0 — `pnpm provision` |
| B2 | Vérifier une identité basedb depuis une autre application | basedb 0.5.0 — introspection, D4 |
| B3 | Prévenir un serveur interne d'un changement de lignes | basedb 0.5.0 — flux SSE suivi pour « Conseillers » |
| B4 | Des vues SQL basedb qui lisent un schéma que basedb ne gère pas | À vérifier |
| B5 | Remettre le jeton d'une personne à une application déclarée (code + PKCE, « Ouvrir la messagerie ») | Demandé — lève la contrainte du même hôte (D4) |

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
