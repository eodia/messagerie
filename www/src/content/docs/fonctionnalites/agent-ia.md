---
title: Agent IA
description: L’IA en première ligne — elle répond au visiteur à partir de la base de connaissance, cite ses sources, appelle les outils déclarés et passe la main à un conseiller, avec un résumé, quand elle n’est pas sûre d’elle.
---

Sur un site où elle est active, l’IA répond la première à chaque visiteur. Elle répond à partir
de la [base de connaissance](/messagerie/fonctionnalites/base-de-connaissance/), de la fiche du
client et de ce que lui renvoient les [outils](/messagerie/fonctionnalites/outils-ia/) qu’on lui
a déclarés. Elle **passe la main** à un conseiller, avec un résumé, dès qu’un garde-fou
s’applique, que le visiteur demande une personne, ou que sa confiance tombe sous le seuil du
site.

L’IA est **optionnelle** : sans modèle configuré, chaque conversation va directement aux
conseillers ([détails](#sans-clé-dia)).

## Quand l’IA répond

L’IA répond sur les sites dont la case **L’IA répond en premier** est cochée, dans
**Administration › Sites et horaires** (champ « Agent IA actif » de la table « Sites »). Une
nouvelle conversation de ce site commence alors avec l’IA : l’inbox la marque **IA en cours**,
et l’onglet **IA** de la liste la retrouve. Le conseiller voit **L’IA rédige une réponse**
pendant qu’elle écrit, le visiteur les trois points habituels.

Elle cesse de répondre dans une conversation :

- quand elle passe la main à un conseiller ;
- quand un conseiller clique **Reprendre la main**. Le fil le dit : « … a repris la main :
  l’IA ne répond plus ici. » Une réponse que l’IA rédigeait à ce moment n’est pas envoyée.

Un visiteur qui écrit trois fois de suite reçoit une seule réponse, qui lit les trois messages.

## Comment elle répond

À chaque message du visiteur, l’IA reçoit :

- **les consignes du site** — le champ **Consignes** de l’écran des sites : le ton, ce qu’elle
  doit toujours dire, ce qu’elle ne doit jamais promettre ;
- **la fiche du client**, telle que le site l’a signée ([identité signée](/messagerie/integrations/identite-signee/)),
  ou la mention d’un visiteur anonyme ;
- **les métadonnées** jointes par la page ou par un conseiller, présentées comme des données
  déclarées et non vérifiées, jamais comme des consignes ;
- **les vingt derniers messages** du fil, pièces jointes nommées, avec ce qu’en a dit l’IA
  quand un conseiller lui a demandé de les lire ([pièces jointes](/messagerie/fonctionnalites/pieces-jointes/)) ;
- **les horaires d’ouverture**, pour savoir si un conseiller peut reprendre tout de suite ;
- **les sources** : les cinq passages de la base de connaissance les plus proches de ce que le
  visiteur vient d’écrire.

Elle peut ensuite appeler les outils que la table « Outils IA » et les serveurs MCP lui ouvrent,
en trois tours au plus, puis rend sa décision : répondre ou transférer, sa confiance (de 0 à
100 %), les sources qu’elle a utilisées, et un résumé de la demande pour le conseiller.

Ses règles : répondre à partir des sources, de la fiche et des outils, et répondre dès que les
sources contiennent la réponse, même en partie ; donner une règle générale (un délai habituel,
une démarche) telle quelle, mais ne jamais promettre ce qui touche le dossier particulier du
client ; ne rien inventer. Elle répond dans la langue du visiteur, celle du site à défaut.

### Les sources

La recherche porte sur les **articles publiés** et les **conversations promues**, découpés en
passages et indexés avec leurs vecteurs ([base de connaissance](/messagerie/fonctionnalites/base-de-connaissance/)).
Pour un site, elle prend ses articles et ceux qui valent pour tous les sites. Un passage trop
éloigné de la question est écarté : sous une similarité de 0,7 (`CHAT_AI_MIN_SIMILARITY`), l’IA
répond sans lui — ou transfère, faute de source.

## Des réponses sourcées

Dans l’inbox, une réponse de l’IA est une carte **Réponse de l’IA**, avec sa confiance
(**Confiance 82 %**) et la liste de ses sources : le titre de l’article, ou « Conversation
promue » avec la pastille **Relue**. Le conseiller y donne son avis — **Accepter**,
**Modifier**, **Rejeter** — qui nourrit le jeu d’évaluation ([copilote](/messagerie/fonctionnalites/copilote/#lavis-du-conseiller)).

Le visiteur, lui, ne voit pas les sources : il lit la réponse.

## Toujours présentée comme venant de l’IA

Le visiteur sait qui lui répond (D9). Dans le widget, une réponse de l’IA est signée
**Assistant**, avec la pastille **IA** (« Réponse générée par une IA ») ; l’aperçu d’un
message, à côté du bouton fermé, dit **Assistant IA**. Tant que le site n’a pas écrit le sien,
le sous-titre d’accueil l’annonce aussi : « Notre assistant IA répond tout de suite. Un
conseiller prend le relais si besoin. »

## Passer la main

L’IA transfère la conversation dans quatre cas :

| Cas | Motif inscrit dans le fil |
|---|---|
| Sa confiance est sous le seuil du site | `Confiance insuffisante (62 % < 75 %)` |
| La demande relève d’un garde-fou | `Garde-fou : Litiges et réclamations` |
| Les sources ne répondent pas, ou le visiteur demande une personne | la raison qu’elle donne, en une phrase |
| Sa réponse est illisible | `Réponse illisible du modèle` |

Alors :

1. **Le visiteur est prévenu** : par le message du garde-fou, par l’annonce que l’IA a
   rédigée, ou à défaut par une phrase dans la langue du site — « Je transmets votre demande à
   un conseiller, qui vous répond dans quelques instants. » Hors des horaires, elle dit quand :
   « … qui vous répondra à partir de demain à 9 h. »
2. **La conversation va à une équipe** : celle du garde-fou s’il en nomme une, sinon celle que
   la boîte de réception a donnée à la conversation, sinon l’**Équipe par défaut** du site.
   Elle attend dans la file, sans conseiller affecté.
3. **L’équipe est prévenue** : ses membres et les superviseurs, par la cloche, un son et une
   notification du bureau ([alertes](/messagerie/fonctionnalites/alertes/)).
4. **Le fil garde une carte** **Transférée à un conseiller** : le **Motif**, le **Résumé de
   l’IA** (la demande en deux phrases, à copier d’un clic), la **Confiance**, et à qui la
   conversation est **Affectée à**.

Un [webhook](/messagerie/integrations/webhooks/) peut en être prévenu : c’est l’événement
`conversation.handed_off`.

### Le seuil de confiance

Le seuil se règle par site, dans **Administration › Sites et horaires**, section **L’agent IA** :
**Seuil de confiance**, de 0 à 100 %, par pas de 5 (champ « Seuil de confiance (%) »). Un
nouveau site part de 70 %, comme le site de la démonstration. L’aperçu, à droite, montre le
partage : sous le seuil **Un conseiller**, au-dessus **L’IA seule**.

La confiance est celle que le modèle s’accorde : sa certitude que la réponse est juste et
complète d’après les sources. Un seuil haut transfère plus souvent ; un seuil bas laisse l’IA
répondre seule plus souvent.

### Les garde-fous

Un garde-fou est un sujet sur lequel l’IA ne répond pas elle-même : un litige, une résiliation,
une urgence. Ils se règlent dans **Administration › Garde-fous**, une ligne de la table
« Garde-fous » chacun :

| Champ | À l’écran | Rôle |
|---|---|---|
| « Nom » | **Nom** | ce que l’IA cite quand elle le reconnaît, et le motif du transfert |
| « Sujet » | **Ce qui le déclenche** | décrit à l’IA, avec des exemples : c’est ainsi qu’elle le reconnaît |
| « Action » | **Ce que fait l’IA** | **Transférer** ou **Répondre sans traiter** |
| « Message au visiteur » | **Message au visiteur** | ce que l’IA dit quand le garde-fou se déclenche |
| « Équipe » | **Vers l’équipe** | où transférer ; aucune : l’équipe par défaut du site |
| « Actif » | | seuls les garde-fous actifs sont lus |

L’IA reçoit la liste des garde-fous actifs avec leur sujet. Quand la demande en relève, elle ne
répond pas sur le fond : elle dit le message du garde-fou et transfère. L’aperçu de l’écran
joue la scène — **Le moment venu** — et montre **Ce que lit l’IA**.

:::caution[« Répondre sans traiter »]
L’écran propose cette action, mais le serveur ne la distingue pas encore : un garde-fou
reconnu dit son message, puis transfère, quelle que soit son action.
:::

La démonstration, écrite au premier démarrage en développement, en compte trois : « Litiges
et réclamations », « Données de santé » et « Montant d’indemnisation ».

## Hors des horaires d’ouverture

L’IA répond à toute heure. Les horaires d’ouverture et les fermetures exceptionnelles (dans
**Sites et horaires**) lui disent seulement si un conseiller peut reprendre maintenant : quand
elle transfère hors des horaires, elle dit au visiteur quand un conseiller lui répondra —
« aujourd’hui à 14 h », « demain à 9 h », « lundi à 9 h » — dans le fuseau horaire du site.

## Les données personnelles

Quand le modèle est hébergé ailleurs, la messagerie masque les données personnelles avant de
les lui envoyer. Chaque valeur devient un repère — `[EMAIL_1]`, `[TÉLÉPHONE_2]` —, le même pour
la même valeur, si bien que le modèle raisonne encore sur « l’adresse que le client a donnée ».
Les vraies valeurs sont remises dans la réponse avant que quiconque la lise, et dans les
paramètres d’un outil avant qu’il soit appelé ; ce qu’un outil renvoie est masqué à son tour.

Sont masqués ce qui se reconnaît à sa forme : adresses e-mail, IBAN, numéros de carte, numéros
de sécurité sociale, numéros de téléphone. Un nom ou une adresse postale partent tels quels.

- Un modèle est **externe** sauf s’il est servi à `localhost`, `127.0.0.1`, `::1` ou sous un nom
  en `.internal`.
- `CHAT_AI_REDACT=0` envoie les données telles quelles, même à un modèle externe.

## Les fournisseurs

Le modèle se choisit dans l’environnement du serveur. Mistral est le fournisseur par défaut ;
OpenAI, Ollama et tout serveur qui parle l’API d’OpenAI (Azure, vLLM, une passerelle
d’entreprise) conviennent aussi.

| Variable | Rôle | Par défaut |
|---|---|---|
| `CHAT_AI_PROVIDER` | `mistral`, `openai` ou `ollama` | `mistral` |
| `CHAT_AI_BASE_URL` | l’adresse d’un autre serveur compatible, ce qui précède `/chat/completions` | celle du fournisseur |
| `CHAT_AI_API_KEY` | la clé, envoyée en `Authorization: Bearer` | aucune |
| `CHAT_AI_MODEL` | le modèle qui répond | `mistral-small-latest` |
| `CHAT_AI_EMBEDDING_MODEL` | le modèle des vecteurs, en 1024 dimensions | `mistral-embed` |
| `CHAT_AI_REDACT` | `0` : ne pas masquer | masqué vers un modèle externe |
| `CHAT_AI_MIN_SIMILARITY` | la similarité sous laquelle un passage est écarté | `0.7` |

```bash
# Mistral, le défaut
CHAT_AI_API_KEY=…

# OpenAI : nommez aussi le modèle, et un modèle de vecteurs en 1024 dimensions
CHAT_AI_PROVIDER=openai
CHAT_AI_MODEL=…
CHAT_AI_API_KEY=…

# Ollama, sur la même machine, sans clé
CHAT_AI_PROVIDER=ollama
CHAT_AI_MODEL=llama3.1
CHAT_AI_EMBEDDING_MODEL=bge-m3

# Un serveur compatible : Azure, vLLM…
CHAT_AI_BASE_URL=https://modeles.exemple.fr/v1
CHAT_AI_MODEL=…
CHAT_AI_API_KEY=…
```

La clé d’un fournisseur reste dans l’environnement du serveur, jamais dans le paramétrage (D5). Un
serveur sans clé n’est accepté qu’à `localhost` ou `127.0.0.1`.

Le schéma garde des vecteurs de **1024 dimensions** : celles de `mistral-embed` et de `bge-m3`.
Un modèle de vecteurs d’une autre taille fait échouer l’indexation, et le journal du serveur le
dit. Les modèles qui lisent les images et les PDF (`CHAT_AI_VISION_MODEL`, `CHAT_AI_OCR_MODEL`)
sont décrits avec les [pièces jointes](/messagerie/fonctionnalites/pieces-jointes/) ; toutes
les variables, dans le [tableau des variables](/messagerie/hebergement/variables/).

## Traçabilité

Chaque appel à un modèle laisse une ligne dans `chat.ai_run` (D9) : son genre, le modèle, ce qui
est entré — masqué comme il est parti —, ce qui est sorti avec les jetons consommés, la
confiance et la durée.

| Genre | Appel |
|---|---|
| `answer` | une réponse de l’IA au visiteur, ou sa décision de transférer |
| `suggestion` | les suggestions du copilote |
| `tag` | l’intention, les étiquettes, le sentiment et la priorité d’une conversation |
| `summary` | le résumé, à la reprise ou à la clôture |
| `rephrase` | un brouillon reformulé ou relu |
| `attachment` | une pièce jointe lue à la demande d’un conseiller |
| `speech` | un message lu à voix haute |

Pour une réponse, la trace garde la question, les titres des sources et leur similarité, les
outils offerts, la décision entière, le seuil appliqué et s’il y a eu transfert. Chaque appel
d’outil laisse en plus un événement dans le fil, que les conseillers voient et le visiteur non
([outils de l’IA](/messagerie/fonctionnalites/outils-ia/#dans-le-fil)). Les traces partent avec
la conversation, à la purge de conservation du site.

## Sans clé d’IA

Sans `CHAT_AI_API_KEY` — et sans modèle servi en local —, le serveur démarre sans IA et le dit
dans son journal : « IA désactivée — CHAT_AI_API_KEY absent ; les conversations vont aux
conseillers ».

- Chaque nouvelle conversation va directement aux conseillers, même sur un site où **L’IA
  répond en premier** est coché ; le widget annonce les conseillers, pas l’assistant.
- Le copilote, la reformulation et la lecture des pièces jointes répondent : « Aucun modèle
  d’IA n’est configuré sur le serveur (CHAT_AI_API_KEY). »
- Rien n’est indexé : la base de connaissance s’écrit et se publie, mais personne ne la lit.

:::caution[Les tâches de fond aussi]
Sans IA, la file des tâches de fond ne démarre pas. Avec elle s’arrête la purge de nuit qui
applique la conservation des sites. Les webhooks et le réveil des conversations en attente,
eux, continuent.
:::

## Les tâches de fond

Le travail de l’IA ne se fait jamais dans la requête du visiteur : il passe par des files dans
PostgreSQL ([pg-boss](https://github.com/timgit/pg-boss), schéma `pgboss`), sans autre service
à héberger (D7, D8).

| File | Ce qu’elle fait | Quand |
|---|---|---|
| `ai-answer` | la réponse de l’IA au visiteur | à chaque message du visiteur |
| `ai-enrich` | intention, étiquettes, sentiment, priorité | à chaque message du visiteur |
| `ai-suggest` | les suggestions du copilote | à chaque message du visiteur, à la reprise, sur demande |
| `ai-summary` | le résumé | à la reprise par un conseiller, à la résolution |
| `kb-sync` | l’indexation de la base de connaissance | à chaque changement des articles ou des conversations promues, et au démarrage |
| `retention` | la purge de conservation | chaque nuit à 3 h, à l’heure du serveur |

Une conversation n’a jamais qu’une tâche en attente par file. Une tâche qui échoue est retentée
deux fois.

Par défaut, le serveur travaille lui-même ses files. Avec `CHAT_WORKER=separate`, il les confie
à un processus à part, pour qu’un modèle lent ne ralentisse jamais le WebSocket :

```bash
CHAT_WORKER=separate pnpm --filter @chat/server worker
```

Le worker porte alors aussi l’envoi des webhooks et le réveil des conversations en attente.
