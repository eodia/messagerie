# 00. Décisions structurantes

Ce chapitre fixe les décisions dont dépend le reste du produit. Il fait autorité : en
cas de divergence avec un autre document, celui-ci l'emporte et l'autre doit être
corrigé. Chaque décision porte un numéro stable, que le code et les autres chapitres
citent (`D1`, `D4`…).

Point de départ : le cadrage « Messagerie client IA » du 29 septembre 2026. Il visait
une messagerie développée en interne. Le produit est devenu un logiciel libre, frère de
basedb dont il garde l'interface (D10). Il s'est d'abord appuyé sur basedb pour tout ce qui
se paramètre ; depuis le 2 octobre 2026, il tient tout lui-même (D19).

---

## Le produit en trois parties

| Partie | Pour qui | Où |
|---|---|---|
| **Le widget** | Les visiteurs d'un site | Un script à coller dans le site (`apps/widget`) |
| **L'inbox** | Les conseillers | Une application web dans le style de basedb (`apps/web`) |
| **Le paramétrage** | Les superviseurs | Dans l'inbox, « Administration » (D19) |

S'y ajoute une partie que personne ne voit : **le serveur du chat** (`apps/server`). Il
porte l'API temps réel, l'IA et les tâches de fond.

---

## D1 — Un seul PostgreSQL, un seul schéma

Tout vit dans le schéma `chat` d'une instance PostgreSQL, que le serveur migre à chaque
démarrage (D8) :

- **le paramétrage** — sites, horaires, fermetures, boîtes de réception, équipes,
  conseillers, réponses types, étiquettes, catégories, articles, conversations promues,
  garde-fous, outils de l'IA, serveurs MCP (D19) ;
- **les comptes** — les conseillers, leurs sessions, les liens d'invitation, leurs
  identités chez un fournisseur OIDC (D4) ;
- **le flux** — contacts, conversations, messages, `ai_runs`, `ai_feedback`, `kb_chunks` et
  leurs vecteurs, pièces jointes, notifications, journal des accès, jetons, webhooks, ce qui
  sort (D23) et les appareils des conseillers.

Une conversation garde l'identifiant texte de son site, de sa boîte et de son équipe, et
le nom du site au moment où elle a commencé : l'historique survit à une ligne supprimée.

## D2 — Remplacée par D19

Le chat lisait le paramétrage dans basedb, par son API. Il le lit dans ses propres tables.

## D3 — L'installation : un PostgreSQL, puis le premier superviseur

Le serveur crée et migre son schéma au démarrage. Au premier lancement, personne ne peut
se connecter : l'écran de connexion crée le premier superviseur, qui invite les autres
(D4) et règle le reste dans l'inbox.

En développement, `docker compose` fait tourner PostgreSQL (`pnpm db:up`). Au premier
démarrage sur une base vide, le serveur écrit la démonstration — Acme Assurances, ses
boîtes, ses équipes, ses articles (`apps/server/src/settings/demo.json`) ; `pnpm seed`
vide le schéma et y ajoute les conversations de démonstration.

## D4 — Les conseillers ont leur compte dans la messagerie

Un conseiller est une ligne de `chat.agent` — sa fiche « Conseillers » et son compte à la
fois. Il se connecte avec son adresse et son mot de passe, ou par le fournisseur
d'identité de l'entreprise (D19).

- **Être conseiller**, c'est être actif dans « Conseillers ». Le rôle « Superviseur » ouvre
  l'administration.
- **Inviter** se fait dans l'inbox : la fiche est créée, et un lien s'affiche une fois, à
  transmettre ; il vaut sept jours, une seule fois, et la personne y choisit son mot de
  passe. Un mot de passe oublié se remplace par un lien de même sorte.
- **Un conseiller cité par des messages n'est jamais supprimé** : retiré, il est désactivé.
- **Un jeton de l'API n'est pas un conseiller** : il écrit sous une ligne à lui
  (`token:<préfixe>`), jamais active (D16).

**Le WebSocket s'ouvre par ticket.** Un navigateur ne peut pas y mettre d'en-tête, et un
jeton dans l'URL finit dans les journaux : l'inbox demande un ticket par HTTP
authentifié, valable une fois, trente secondes.

En développement seulement, `CHAT_DEV_AGENT` nomme le conseiller (son adresse) au nom
duquel se font les requêtes sans session : pas de connexion sur une machine de
développement. En production, une requête sans session est refusée.

## D5 — Les visiteurs n'ont pas de compte, et les secrets restent hors du paramétrage

Les contacts vivent dans le schéma `chat`. Un visiteur est anonyme jusqu'à ce que le
site signe son identité (HMAC ou JWT). Le widget n'accepte jamais un identifiant non
signé.

La clé de signature d'un site ne va pas dans le paramétrage : tout superviseur qui le
lit la verrait. Le serveur la garde à part (`site_secret`), liée à l'identifiant de la
ligne « Sites ». Les clés des fournisseurs d'IA restent dans l'environnement du serveur ;
un outil ou un serveur MCP y nomme une variable (`${NOM}`), jamais une valeur.

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

### Le paramétrage se fait dans l'inbox

Un superviseur règle la messagerie sans la quitter : « Administration », au pied de la
barre latérale, ouvre les écrans des boîtes de réception, des équipes et des conseillers,
des sites et de leurs horaires, des réponses types et des étiquettes, des garde-fous, des
outils de l'IA et des serveurs MCP, du widget, de l'API et des webhooks. Les conseillers
n'en voient rien ; le serveur leur refuse ces tables, en écriture comme en lecture.

Chaque écran est bâti comme l'éditeur du widget : les lignes à gauche, le formulaire au
milieu, et à droite ce que le réglage change, dessiné en direct — la boîte dans le menu et
le chemin d'une conversation, la semaine d'ouverture, la réponse type dans le composeur,
le garde-fou qui se déclenche, l'outil tel que l'IA le lit et la requête qu'il envoie. Les
changements restent des brouillons, ligne par ligne, jusqu'à « Enregistrer » (ou Ctrl+S).

Les champs, leurs genres, leurs choix et leurs relations sont ceux que déclare
`apps/server/src/settings/model.json` ; le serveur vérifie chaque valeur contre lui, puis
l'écrit dans la table, par libellé de champ (D19).

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
police, un logo qui n'est pas en https, une marge hors bornes sont lus comme vides, d'où
qu'ils viennent.

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
  fil, les signaux temps réel, les cloches, les contacts (ceux qui ont écrit dans ces
  boîtes) et les compteurs. Une conversation d'avant les boîtes est à tous.
- **Sites.** Le menu en haut de la barre latérale restreint l'inbox à un site : ses
  conversations et leurs pastilles, ses contacts, ses articles (et ceux de tous les sites),
  ses compteurs. Il propose les sites dont on voit les conversations : un superviseur, tous ;
  un conseiller, ceux qui arrivent dans une de ses boîtes, et ceux d'une conversation qu'on y
  a transférée. C'est une vue, pas un droit : le choix est gardé par le navigateur, l'adresse
  ne le porte pas. Le compteur de l'onglet et les alertes restent ceux de tous les sites ; ouvrir
  une conversation d'un autre site, depuis la cloche ou une adresse, revient à « Tous les
  sites ».
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
  défaut), jamais dans la base ; la table `chat.attachment` garde le nom,
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
dans le schéma `chat`. Un jeton n'atteint pas `/api/inbox` : il ne
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
journal), envoyer un test, lire les derniers envois. Ils restent dans le schéma `chat`.

## D18 — Où est un contact : son fuseau horaire, pas son adresse IP

Un drapeau dans la liste des contacts, une carte qui vole jusqu'à eux : il faut savoir à
peu près où ils sont. La Messagerie ne le demande à personne — ni base GeoIP, ni service
tiers : le widget transmet le fuseau horaire du navigateur (`Europe/Paris`), et la table
des fuseaux de la base tz (`zone.tab`, générée dans `apps/server/src/places/zones.ts`) en
dit le pays et la ville de référence. Les anciens noms que donnent encore les navigateurs
(`Asia/Calcutta`) y sont.

- Le contact garde `country`, `time_zone`, `latitude`, `longitude`. Le point du fuseau est
  marqué « approximatif » : la carte montre alors le pays, pas la ville.
- Un point plus précis — donné par un site, ou le jeu de démonstration — n'est jamais
  remplacé par celui d'un fuseau ; un visiteur qui voyage suit son fuseau.
- La carte est celle d'OpenStreetMap, dessinée par Leaflet comme dans basedb : seules les
  tuiles sont demandées, par le navigateur du conseiller. Les drapeaux sont des SVG
  (`flag-icons`) : Windows écrit les drapeaux emoji en deux lettres.

---

## D19 — La messagerie tient tout elle-même

Décidé le 2 octobre 2026 : la messagerie ne dépend plus de basedb. Deux produits à
installer, un jeton à émettre, un modèle à faire évoluer par l'API d'administration, la
contrainte du même hôte pour partager une session — pour quatorze petites tables que les
écrans de l'inbox éditaient déjà. Et les tableaux de bord de basedb ne voyaient pas le
flux, qui vit dans le schéma `chat`.

**Le paramétrage** est fait de tables du schéma `chat`, avec leurs clés étrangères et
leurs tables de liaison (`apps/server/src/db/schema.ts`). Les écrans et `Settings` parlent
en libellés de champs ; `settings/catalog.ts` dit, pour chaque table, quelle colonne ou
quelle liaison porte chaque libellé. Une écriture prévient tous les processus du chat
(`NOTIFY chat_settings`), qui oublient la table.

**Les comptes :**

- un mot de passe gardé en scrypt ; huit caractères au moins, pas l'adresse ;
- une session dans un cookie `httpOnly`, `SameSite=Lax`, dont la base ne garde que le
  SHA-256 ; trente jours depuis son dernier usage ; la déconnexion la supprime, un
  nouveau mot de passe ferme toutes les autres ;
- chaque écriture de l'inbox porte l'en-tête `X-Chat-Request`, qu'une page d'un autre
  site ne peut pas envoyer sans que CORS l'autorise — et CORS n'autorise que l'inbox ;
- dix essais de connexion par quart d'heure et par adresse e-mail, trente par adresse IP ;
- l'inbox et le serveur doivent partager un site (`app.exemple.fr` et `api.exemple.fr`, ou
  le même hôte) : le cookie de session est celui du serveur.

**Un fournisseur OpenID Connect** — Microsoft Entra, Google, Keycloak… — connecte le
conseiller de la même adresse, vérifiée par lui (`CHAT_OIDC_ISSUER`,
`CHAT_OIDC_CLIENT_ID`, `CHAT_OIDC_CLIENT_SECRET`). Flux « code » avec PKCE ; l'identité est
ensuite retenue par son émetteur et son `sub`. Il ne crée personne : on invite d'abord.

**La relecture des conversations promues** se fait dans « Connaissances » : la question et
la réponse se corrigent, puis se publient — l'IA s'en sert — ou se rejettent.

## D20 — Les automatisations, celles de basedb faites pour les conversations

Une automatisation part d'un **déclencheur**, retient les **conversations** qui remplissent
sa condition, et enchaîne des **étapes** : le flux de basedb, dessiné de même (React Flow,
une carte par étape, un « + » sur chaque lien), dans « Administration › Automatisations ».

- **Déclencheurs :** une conversation commence ; le visiteur écrit ; l'IA passe la main ;
  attribuée, transférée, résolue, rouverte ; l'humeur change ; le visiteur attend une
  réponse depuis N minutes ; à heure fixe — une fois, ou pour chaque conversation que la
  condition retient ; un bouton dans la conversation ; l'appel d'un autre système, à
  l'adresse de l'automatisation et avec sa clé.
- **Étapes :** attribuer (à quelqu'un, au moins occupé d'une équipe, à tour de rôle),
  transférer, étiqueter, priorité, statut, répondre, noter, demander l'e-mail du visiteur,
  prévenir, appeler une adresse, demander à l'IA (classer ou rédiger), noter une donnée ;
  une condition ouvre des chemins ; une attente reprend plus tard, sauf si le visiteur a
  écrit. Les textes citent la conversation : `{{contact.prenom}}`, `{{etape.s2}}`.
- **Le moteur** lit les événements que captent les déclencheurs de la base (D17), crée les
  exécutions de celles qui écoutent, et les mène étape par étape, toutes les deux secondes,
  à plusieurs processus (`SKIP LOCKED`). Une attente met l'exécution de côté jusqu'à son
  heure.
- **Chaque automatisation agit sous sa propre ligne de conseiller** (`automation:<id>`),
  jamais active : le fil dit qui a fait quoi ; le visiteur lit ses réponses au nom du site.
- **Pas de boucle :** une automatisation ne se déclenche jamais sur ce que son exécution a
  fait (`chat.automation_run`, que la transaction nomme et que l'événement garde) ; une
  chaîne s'arrête à trois ; cent exécutions par heure au plus.
- **Une exécution interrompue** — le processus est tombé — échoue (`INTERRUPTED`) plutôt
  que de recommencer : ses étapes ont peut-être déjà écrit.
- **Par défaut**, une messagerie commence avec « Demander l'e-mail quand la réponse tarde ».
  Quand l'IA passe la main site fermé, le widget demande l'adresse lui-même.

## D21 — Les actions de la page

Le widget relie l'IA à la page qui l'accueille : la page **déclare** ce qu'elle sait faire
(`MessagerieChat.registerAction`) — chercher, tarifer, remplir un formulaire, ouvrir une
étape —, et dit où elle en est (`setPageContext`). C'est la page qui calcule : un tarif ne
se recopie pas dans le serveur, l'IA le demande à la page.

- **Un superviseur autorise** chaque action, dans « Widget › Actions » : une page qui en
  déclare une nouvelle ne la donne pas à l'IA tant qu'elle n'est pas autorisée.
  « Accord du visiteur » est mis d'office pour ce qui change la page.
- **L'instantané de la page** (adresse, titre, contexte, actions) part avec chaque message
  du visiteur ; l'IA le lit comme une donnée non vérifiée, jamais comme une consigne (D13).
- **Un aller-retour réel :** l'IA appelle l'action ; un appel est écrit, avec son événement
  dans le fil ; **un seul** onglet du visiteur le prend (`claim`), l'exécute et répond. Une
  lecture attend sa réponse dix secondes, puis « page indisponible ».
- **Ce que le visiteur doit accepter** termine le tour de l'IA : le widget montre la
  proposition et ses valeurs, « Accepter » ou « Non merci » ; la réponse relance l'IA, qui
  part du résultat. Une proposition non répondue expire au bout d'une demi-heure.
- **Règle d'or** dans le prompt : jamais « c'est fait » sans un résultat `ok`. Une réponse
  fondée sur ce que la page a renvoyé n'est pas jugée par le seuil de confiance de la base
  de connaissance.
- La page de démonstration (`/demo`) déclare un tarif, un devis à pré-remplir et une
  section à montrer.
- **Où est le visiteur :** une fois la conversation commencée, le widget dit par sa
  connexion temps réel chaque page qu'il ouvre (adresse et titre, un site d'une seule page
  compris) ; la fermer, c'est la quitter. Table `page_view`, cent par conversation ; l'adresse
  sans fragment ni paramètre qui ressemble à un secret ou à une personne. Rien pour un
  visiteur qui n'a jamais écrit. Au démarrage, le serveur ferme les pages restées ouvertes.
  L'inbox en tire la page ouverte, la pastille de présence et la piste des pages vues.

## D22 — Les tableaux de bord, ceux de basedb faits pour les conversations

« Tableaux de bord » remplace « Statistiques » : des cartes sur une grille de douze
colonnes (react-grid-layout), chacune une question dessinée en nombre, tendance (la
dernière période contre la précédente), objectif, tableau triable, barres, courbe, aire ou
camembert (ECharts, la palette catégorielle validée ; une humeur ou un avis gardent leur
couleur de sens), sous des cartes « titre » qui séparent les sections.

- **Ce qu'on lit :** les vues du schéma `analytics` — conversations, messages, appels à
  l'IA, avis sur l'IA, étiquettes, contacts, exécutions d'automatisations —, jamais les
  tables elles-mêmes. Leurs colonnes ont un libellé en français (`analytics/catalog.ts`).
- **Le détail d'une carte :** son titre l'ouvre en grand — graphique, chiffres, et pour une
  question assistée les lignes derrière elle (500 au plus), sous les filtres du tableau. Un
  point cliqué ouvre les lignes de ce point : chaque regroupement devient une condition
  (`at` pour une date, comparée au groupe tel que Postgres l'a écrit), vérifiée comme toute
  question assistée.
- **Une question assistée :** le carnet de basedb (données, filtre, résumer… par…, trier,
  limiter, en pastilles colorées) : une source, des filtres (dont « dans les derniers N jours »,
  au fuseau du lecteur), des calculs (nombre, distincts, somme, moyenne, médiane, part des
  « oui »), deux regroupements au plus (une date par heure, jour, semaine, mois, jour de la
  semaine…). Compilée en SQL paramétré, chaque nom pris dans le catalogue.
- **Une question en SQL :** un seul `SELECT`, lancé par le protocole étendu (une instruction,
  pas deux), dans une transaction `READ ONLY` de quinze secondes au plus, sous le rôle
  `chat_analytics`, qui lit les vues et rien d'autre : ni comptes, ni sessions, ni secrets.
  Sans ce rôle — un utilisateur de base qui ne peut pas en créer —, le SQL est refusé
  (`SQL_UNAVAILABLE`), les questions assistées restent. L'IA écrit la requête d'une phrase,
  et l'essaie avant de la proposer.
- **Les filtres** (les paramètres de basedb) : une période, des valeurs à choisir, un texte,
  au-dessus des cartes. Chaque carte est liée ou non à chacun, sur une colonne de sa question ;
  une valeur choisie remplace ce que la carte filtre sur cette colonne. Les questions en SQL ne
  les suivent pas. Un conseiller choisit des valeurs, jamais les liens.
- **Qui voit quoi :** les superviseurs font et changent les tableaux ; un tableau « visible
  des conseillers » s'ouvre à tous, et une carte s'y exécute telle qu'enregistrée — un
  conseiller n'envoie jamais de SQL.
- **Par défaut**, « Vue d'ensemble », en trois sections : *Activité* (conversations,
  résolution par l'IA, première réponse, transferts — en tendances de la semaine —,
  conversations par jour, par boîte), *Visiteurs et IA* (humeur, étiquettes, avis sur l'IA),
  *Équipe* (charge par conseiller, heures où les visiteurs écrivent).

## D23 — Ce qui sort de la messagerie : e-mails, alertes sur le téléphone, SMS et RCS

La messagerie ne parlait qu'au widget et à l'inbox ouverte. Elle écrit désormais ailleurs : par
e-mail, sur le téléphone d'un conseiller, et par SMS ou RCS au visiteur qui écrit depuis le sien.

**Une file, captée dans la transaction.** Tout ce qui sort passe par `chat.outbound`, que relève
un facteur (`apps/server/src/outbound/dispatch.ts`) toutes les deux secondes, là où tournent les
webhooks (D17) : sous bail, à plusieurs processus (`SKIP LOCKED`), six essais sur une heure et
quart, puis échec avec son code (D9 bis). Une réponse au visiteur y entre par un déclencheur sur
`chat.message`, dans la transaction qui l'écrit, quel que soit son chemin — inbox, IA,
automatisation, API ; une alerte, par `notify`, avec la ligne de cloche. Un message écrit dans le
passé (la démonstration, un import) n'y entre pas. Gardée 90 jours ; purgée avec sa conversation.

**Les e-mails** passent par un serveur SMTP (`CHAT_SMTP_URL`, `CHAT_MAIL_FROM`) ; sans lui, aucun.

- Les **liens des comptes** (D4) partent aussi à l'adresse du conseiller : l'invitation, le
  nouveau mot de passe. Le lien reste affiché une fois — un e-mail se perd. Il n'est jamais
  écrit dans la file : la base n'en garde que l'empreinte.
- **Mot de passe oublié ?** envoie un lien à l'adresse tapée. Même réponse, en même temps,
  que l'adresse soit connue ou non ; l'envoi se fait après la réponse.
- **Le visiteur qui a laissé son e-mail** (la carte du widget, D20) reçoit les réponses qu'il
  n'a pas vues : deux minutes d'attente, puis un e-mail qui réunit les réponses écrites depuis
  qu'il a quitté sa dernière page (`page_view`, D21) — rien s'il a une page ouverte. Dans la
  langue du site, avec un lien vers la page d'où il écrivait. Il ne répond pas par e-mail : il
  revient sur le site. Un site le coupe (« Répondre par e-mail », coché par défaut) : le
  client que le site a signé a une adresse, et l'activer pour les invitations n'impose pas
  d'écrire aux clients.
- **Un conseiller qui le demande** reçoit par e-mail ce qui reste non lu dans sa cloche dix
  minutes : une fois par ligne.

**Les alertes sur le téléphone** sont du Web Push, sans bibliothèque ni service tiers (RFC 8291,
8292) : l'inbox s'installe (manifeste, service worker `/sw.js`) et chaque appareil s'abonne
depuis le menu du compte. Ce qui reste non lu quinze secondes dans la cloche y part, chiffré pour
l'appareil seul ; un onglet de l'inbox au premier plan le tait. La clé VAPID est tirée de
`CHAT_SECRET`, pour ce seul usage : rien à régler, et la changer réabonne les appareils. Le
serveur n'appelle que les services de push des navigateurs (Google, Mozilla, Apple, Microsoft),
et oublie un appareil que son service dit parti. Un iPhone ne reçoit les alertes que de l'inbox
ajoutée à l'écran d'accueil.

**SMS et RCS** passent par un fournisseur — Twilio ou SMS Mode —, derrière une interface
commune (`channels/provider.ts`) : ses identifiants, les adresses où il appelle, comment
reconnaître ses appels, ce qu'ils disent, comment envoyer. Un autre fournisseur s'y ajoute,
et à « Fournisseur » dans le modèle ; le reste de la messagerie ne le connaît pas.

- **Un numéro** est une ligne de « Numéros SMS » : son fournisseur, la variable de son secret
  (D5) — l'Auth Token de Twilio, la clé d'API de SMS Mode —, son site, dont les conversations
  prennent la boîte, l'équipe, l'IA et la langue. Chez Twilio, l'identifiant du compte et,
  pour le RCS, un service de messagerie avec un expéditeur RCS, qui écrit en RCS aux téléphones
  qui le lisent et en SMS aux autres. Chez SMS Mode, un nom d'expéditeur, facultatif — auquel
  un client ne peut pas répondre.
- **Ce qui arrive** est un appel du fournisseur à `/channels/<fournisseur>/<numéro>`. Twilio
  le signe avec le jeton du compte. SMS Mode ne signe rien : l'adresse porte une clé tirée de
  `CHAT_SECRET` pour ce numéro, donnée à chaque envoi (`callbackUrlMo`, `callbackUrlStatus`) et
  dans l'espace SMS Mode ; le serveur dit l'adresse à l'écran, puisque lui seul tire la clé. Un
  appel sans signature ou sans clé est refusé. Ce que SMS Mode poste est lu avec indulgence — un
  champ sous un nom ou un autre —, jamais deviné : un message dont on ne sait pas qui l'écrit
  est refusé. Le téléphone est un contact du site, nommé par son numéro ; sa conversation,
  celle du numéro (une conversation résolue depuis plus d'un jour est finie). Un message
  rejoué n'est écrit qu'une fois. Une image, un PDF suivent la règle des pièces jointes (D14).
- **Une conversation garde son canal** (`web`, `sms`, `rcs`), celui du dernier message du
  visiteur. L'IA y répond en texte simple ; la carte de l'e-mail n'y est pas demandée.
- **Ce qui repart** : chaque réponse, dans l'ordre de la conversation, en texte simple, en
  plusieurs messages au-delà de 1 600 caractères. Un fichier part tel quel où le fournisseur
  et le numéro le portent (RCS) ; ailleurs, son lien signé, valable un jour, est dans le texte.
  Le fournisseur dit ensuite remis, lu (RCS) ou non remis, avec son code : l'inbox l'écrit sous
  la réponse.

**Écrire le premier.** Un conseiller — « Nouveau message » — ou un programme — l'API,
`POST /conversations`, et l'outil MCP `start_conversation` — écrit à un client qui n'a rien
demandé : un contact connu, un numéro ou une adresse. Par SMS, depuis un numéro prêt à
envoyer : la conversation de ce téléphone sur ce numéro, celle où sa réponse arrivera. Par
e-mail : la conversation du widget du contact, encore en cours, ou une nouvelle — l'e-mail part
sans attendre, et le widget la lui montre s'il revient sur le site ; un site qui n'écrit pas
d'e-mails à ses clients le refuse (`EMAIL_REPLIES_OFF`). La nouvelle conversation arrive dans
la boîte de son site, que l'auteur doit voir ; elle est à lui, comme s'il avait répondu, et
l'IA n'y répond pas la première. Un jeton la laisse dans la file.

## Questions ouvertes

Reprises du cadrage :

- Quel modèle LLM est autorisé, et avec quelles données ?
- Quels sites embarquent le widget au lancement, et leurs clients y sont-ils connectés ?
- Quels outils métier l'agent peut-il appeler en phase 4 ?
- Faut-il le canal e-mail dès le MVP ? (D23 envoie des e-mails ; les recevoir reste ouvert.)
- Quelle durée de conservation impose la conformité ?
- Quel volume à dimensionner (conversations par jour, conseillers simultanés) ?

Nouvelles, nées de ce chapitre :

- Le nom du produit : « Messagerie » est un nom de travail (`apps/web/src/lib/product.ts`).
