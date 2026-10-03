---
title: SMS et RCS
description: Des clients qui écrivent par SMS ou par RCS depuis leur téléphone, à un numéro Twilio — leurs conversations dans l’inbox, l’IA et les conseillers qui y répondent, les réponses qui repartent sur leur téléphone.
---

Le widget n’est pas le seul chemin : un client écrit aussi par **SMS** — ou par **RCS**, les
messages enrichis d’Android et d’iOS — à un numéro de l’entreprise. Sa conversation arrive dans
l’inbox comme une autre ; l’IA y répond la première si le site le veut, un conseiller reprend,
et chaque réponse repart sur son téléphone (D23).

La messagerie passe par [Twilio](https://www.twilio.com), qui fournit le numéro et achemine les
messages.

## Ce que vit le client

- Il écrit au numéro. Sa première réponse vient de l’IA, ou d’un conseiller si le site n’a pas
  d’agent IA — comme dans le widget.
- Les réponses arrivent en **texte simple** : le gras, les listes, les titres sont retirés ; un
  lien s’écrit en clair, après son libellé. Au-delà de 1 600 caractères, une réponse part en
  plusieurs messages, coupés entre deux mots.
- **Une photo, un PDF** qu’il envoie (MMS ou RCS) arrivent dans le fil comme une
  [pièce jointe](/messagerie/fonctionnalites/pieces-jointes/), s’ils sont d’un type que la
  messagerie prend. Un fichier envoyé par un conseiller part tel quel en RCS ; en SMS, son lien
  — valable un jour — est ajouté au texte.
- Une conversation résolue depuis plus d’un jour est finie : son prochain message en ouvre une
  nouvelle, comme dans le widget.

## Dans l’inbox

- **Le contact** est nommé par son numéro, au format international (`+33612345678`), avec un
  téléphone pour avatar. Il est anonyme ; un conseiller complète ce qu’il en sait sous
  **Déclaré sur le contact**. Un même numéro reste le même contact, sur le même site.
- **La liste** marque d’un téléphone orange une conversation par SMS ou RCS ; le panneau de
  détails dit son **Canal** et le numéro.
- **Le composeur** le rappelle : « Répondre par SMS, en texte simple ». Les notes internes, elles,
  ne quittent jamais l’inbox.
- **Sous chaque réponse**, ce qu’il en est advenu : **SMS en file**, **Envoyé**, **Remis**,
  **Lu** (RCS seulement), ou **Non remis** — survolé, le motif : le client a répondu STOP, le
  numéro ne reçoit pas de SMS, le téléphone est injoignable, le numéro de l’entreprise est mal
  réglé…
- **L’IA** sait qu’elle écrit sur un téléphone : quelques phrases courtes, sans mise en forme,
  sans numéro de source. La carte « Laissez-nous votre e-mail » n’est jamais demandée : le
  numéro suffit pour répondre plus tard.

Le canal d’une conversation suit le dernier message du client : un client qui passe du RCS au
SMS — son téléphone a changé — est suivi.

## Ajouter un numéro

**Administration › Numéros SMS**, **Nouveau numéro**. Le formulaire :

| Champ | Ce qu’il dit |
|---|---|
| **Nom** | comment l’inbox le nomme : « Service client — SMS » |
| **Numéro** | le numéro Twilio, au format international : `+33 7 00 00 00 00` |
| **Site** | le site dont ses conversations sont : sa boîte de réception, son équipe, son agent IA, ses horaires, sa langue. Aucun : le premier site actif |
| **Compte Twilio** | l’identifiant du compte, **Account SID** (`AC…`), dans la console Twilio |
| **Jeton (variable d’environnement)** | le **nom** de la variable du serveur qui contient l’**Auth Token** du compte — jamais le jeton lui-même (D5) |
| **Service de messagerie** | facultatif : un service de messagerie Twilio (`MG…`). Pour le RCS — voir plus bas |
| **Actif** | désactivé, le numéro refuse ce qui arrive et n’envoie plus rien |

À droite, l’aperçu **Dans Twilio** donne, une fois le numéro enregistré, l’adresse à coller dans
Twilio, avec **Copier**, et dit ce qui manque encore.

Puis, sur le serveur, définissez la variable nommée — `TWILIO_AUTH_TOKEN=…` à côté des autres
variables (voir [variables](/messagerie/hebergement/variables/#sms-et-rcs)) — et relancez-le.

### Dans la console Twilio

Twilio appelle la messagerie à chaque message reçu, à l’adresse que donne l’aperçu :

```text
{CHAT_PUBLIC_URL}/channels/twilio/<identifiant du numéro>
```

- **Un numéro seul** : **Phone Numbers › Manage › Active numbers**, le numéro, section
  **Messaging Configuration** : **A message comes in**, **Webhook**, cette adresse, **HTTP POST**.
- **Un service de messagerie** : **Messaging › Services**, le service, **Integration** :
  **Send a webhook**, cette adresse dans **Request URL**.

Rien d’autre à régler : chaque envoi donne lui-même à Twilio l’adresse où dire ce que devient le
message (`…/status`).

`CHAT_PUBLIC_URL` doit être joignable depuis Internet, en HTTPS. Sur un poste de
développement, un tunnel (`ngrok`, `cloudflared`) l’expose ; `CHAT_PUBLIC_URL` prend alors
l’adresse du tunnel.

### Le RCS

Le RCS passe par un **service de messagerie** Twilio qui a un **expéditeur RCS** — à faire
approuver chez Twilio pour votre marque —, et le numéro dans son pool d’expéditeurs. Donnez son
identifiant (`MG…`) dans **Service de messagerie** : les réponses partent alors par le service,
qui écrit en **RCS** aux téléphones qui le lisent, avec images et fichiers, et en **SMS** aux
autres. Les accusés de lecture — **Lu** — n’existent qu’en RCS.

## Ce que vérifie la messagerie

- **La signature** : Twilio signe chaque appel avec l’Auth Token du compte (`X-Twilio-Signature`).
  Un appel dont la signature ne tient pas est refusé, comme celui d’un autre compte. Le serveur
  vérifie l’adresse telle que Twilio l’a appelée : `CHAT_PUBLIC_URL`, exactement.
- **Une seule fois** : Twilio rejoue un appel resté sans réponse ; le message n’est écrit
  qu’une fois.
- **Les fichiers** du client sont lus chez Twilio avec le compte du numéro, et suivent les règles
  des pièces jointes : type décidé sur les octets, 10 Mo, cinq par message. Le reste est ignoré.
- **L’ordre** : les réponses d’une conversation partent l’une après l’autre ; une réponse que
  Twilio n’a pas pu prendre est réessayée — six fois sur une heure et quart — avant les
  suivantes. Refusée pour de bon, elle est **Non remis**, et les suivantes partent.

## STOP et consentement

Un client qui répond **STOP** ne reçoit plus rien de ce numéro : Twilio le gère, et la
messagerie le dit sous chaque réponse — **Non remis**, « Le client a répondu STOP ». Il lui
suffit d’écrire **START** pour reprendre. Les règles d’envoi de SMS commerciaux (consentement,
horaires) restent celles de votre pays : la messagerie ne fait que répondre à qui lui écrit.

## Dans les automatisations, l’API et les tableaux de bord

- Une conversation par SMS déclenche les [automatisations](/messagerie/fonctionnalites/automatisations/)
  comme une autre ; une étape **Répondre** part sur le téléphone.
- Une réponse envoyée par l’[API REST](/messagerie/integrations/api-rest/) ou le serveur MCP
  aussi. Une conversation y porte `channel` (`web`, `sms`, `rcs`), et une réponse partie hors du
  widget, `delivery`.
- Les [tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/) lisent le **Canal** de
  chaque conversation : Widget, SMS ou RCS.
