---
title: SMS et RCS
description: Des clients qui écrivent par SMS ou par RCS depuis leur téléphone, à un numéro Twilio ou SMS Mode — leurs conversations dans l’inbox, l’IA et les conseillers qui y répondent, les réponses qui repartent sur leur téléphone, et les messages qu’on leur écrit le premier.
---

Le widget n’est pas le seul chemin : un client écrit aussi par **SMS** — ou par **RCS**, les
messages enrichis d’Android et d’iOS — à un numéro de l’entreprise. Sa conversation arrive dans
l’inbox comme une autre ; l’IA y répond la première si le site le veut, un conseiller reprend,
et chaque réponse repart sur son téléphone. Un conseiller peut aussi lui écrire le premier
(D23).

Un numéro passe par un **fournisseur**, qui l’achemine :

| Fournisseur | Ce qu’il porte |
|---|---|
| [Twilio](https://www.twilio.com) | SMS, MMS, et RCS avec un service de messagerie |
| [SMS Mode](https://www.smsmode.com) | SMS, depuis la France, avec un nom d’expéditeur si l’on veut |

## Ce que vit le client

- Il écrit au numéro. Sa première réponse vient de l’IA, ou d’un conseiller si le site n’a pas
  d’agent IA — comme dans le widget.
- Les réponses arrivent en **texte simple** : le gras, les listes, les titres sont retirés ; un
  lien s’écrit en clair, après son libellé. Au-delà de 1 600 caractères, une réponse part en
  plusieurs messages, coupés entre deux mots.
- **Une photo, un PDF** qu’il envoie par MMS ou RCS (Twilio) arrivent dans le fil comme une
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

## Écrire le premier

Un conseiller écrit à un client qui n’a rien demandé : un rappel, une pièce qui manque, une
attestation prête. **Nouveau message** — le crayon en haut de la liste des conversations, la
palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>), ou **Écrire** sur la fiche d’un contact — ouvre le
dialogue :

1. **SMS** ou **E-mail**. Un canal que la messagerie ne peut pas utiliser le dit : aucun
   numéro prêt, ou ni adresse de site ni serveur d’e-mail.
2. **Destinataire** : un nom, que la messagerie cherche parmi les contacts, ou directement un
   numéro (`06 12 34 56 78` se lit `+33612345678`) ou une adresse. Un contact sans numéro — ou
   sans adresse — en demande un, qui va sur sa fiche. Un nouveau contact peut recevoir un **nom**.
3. **Depuis** : le numéro d’envoi, s’il y en a plusieurs. **Pour le site** : celui d’une
   nouvelle adresse e-mail, s’il y en a plusieurs.
4. Le **Message**, avec le compte de ses caractères et de ses SMS ; **Envoyer le SMS** — ou
   <kbd>Ctrl</kbd>+<kbd>Entrée</kbd>.

La conversation s’ouvre aussitôt. Elle est au conseiller qui a écrit, dans la boîte du site —
une boîte qu’il voit ; l’IA n’y répond pas la première.

- **Par SMS**, c’est la conversation de ce téléphone sur ce numéro : quand le client répond, sa
  réponse y arrive, et le conseiller est appelé comme pour tout message.
- **Par e-mail, depuis un site qui a son [adresse](/messagerie/fonctionnalites/e-mail/)**,
  c’est une conversation par e-mail : l’e-mail part de cette adresse, et la réponse du client
  arrive dans la conversation.
- **Par e-mail, sinon**, c’est la conversation du widget du contact, encore en cours, ou une nouvelle.
  L’e-mail part tout de suite, signé du site, avec un bouton **Reprendre la conversation**
  ([le widget](/messagerie/fonctionnalites/widget/#la-réponse-par-e-mail)) : le client répond
  en revenant sur le site, où le widget lui montre la conversation s’il revient du même
  navigateur. Un site qui n’écrit pas d’e-mails à ses clients — **Répondre par e-mail**
  décoché — le refuse.

Un programme le fait aussi, par l’[API REST](/messagerie/integrations/api-rest/#écrire-en-premier)
ou l’outil MCP `start_conversation` ; la conversation reste alors dans la file.

## Ajouter un numéro

**Administration › Numéros SMS**, **Nouveau numéro**. Le formulaire :

| Champ | Ce qu’il dit |
|---|---|
| **Nom** | comment l’inbox le nomme : « Service client — SMS » |
| **Numéro** | le numéro chez le fournisseur, au format international : `+33 7 00 00 00 00` |
| **Site** | le site dont ses conversations sont : sa boîte de réception, son équipe, son agent IA, ses horaires, sa langue. Aucun : le premier site actif |
| **Fournisseur** | **Twilio** ou **SMS Mode** |
| **Identifiant du compte** | Twilio : l’**Account SID** (`AC…`), dans la console Twilio |
| **Secret (variable d’environnement)** | le **nom** de la variable du serveur qui contient le secret du compte — l’**Auth Token** de Twilio, la **clé d’API** de SMS Mode —, jamais le secret lui-même (D5) |
| **Service de messagerie** | Twilio, facultatif : un service de messagerie (`MG…`), pour le RCS — voir plus bas |
| **Expéditeur** | SMS Mode, facultatif : le nom affiché à la place du numéro, 11 caractères au plus |
| **Actif** | désactivé, le numéro refuse ce qui arrive et n’envoie plus rien |

À droite, l’aperçu donne, une fois le numéro enregistré, l’**adresse à donner au
fournisseur**, avec **Copier**, et dit ce qui manque encore. C’est le serveur qui la donne :
pour SMS Mode, elle porte une clé que lui seul sait tirer.

Puis, sur le serveur, définissez la variable nommée — `TWILIO_AUTH_TOKEN=…` ou
`SMSMODE_API_KEY=…`, à côté des autres variables (voir
[variables](/messagerie/hebergement/variables/#sms-et-rcs)) — et relancez-le.

`CHAT_PUBLIC_URL` doit être joignable depuis Internet, en HTTPS. Sur un poste de
développement, un tunnel (`ngrok`, `cloudflared`) l’expose ; `CHAT_PUBLIC_URL` prend alors
l’adresse du tunnel.

### Twilio

Twilio appelle la messagerie à chaque message reçu, à l’adresse que donne l’aperçu :

```text
{CHAT_PUBLIC_URL}/channels/twilio/<identifiant du numéro>
```

- **Un numéro seul** : **Phone Numbers › Manage › Active numbers**, le numéro, section
  **Messaging Configuration** : **A message comes in**, **Webhook**, cette adresse, **HTTP POST**.
- **Un service de messagerie** : **Messaging › Services**, le service, **Integration** :
  **Send a webhook**, cette adresse dans **Request URL**.

Rien d’autre à régler : chaque envoi donne lui-même à Twilio l’adresse où dire ce que devient le
message (`…/status`). Twilio signe chaque appel avec l’Auth Token du compte
(`X-Twilio-Signature`) : un appel dont la signature ne tient pas est refusé, comme celui d’un
autre compte. Le serveur vérifie l’adresse telle que Twilio l’a appelée : `CHAT_PUBLIC_URL`,
exactement.

**Le RCS** passe par un **service de messagerie** Twilio qui a un **expéditeur RCS** — à faire
approuver chez Twilio pour votre marque —, et le numéro dans son pool d’expéditeurs. Donnez son
identifiant (`MG…`) dans **Service de messagerie** : les réponses partent alors par le service,
qui écrit en **RCS** aux téléphones qui le lisent, avec images et fichiers, et en **SMS** aux
autres. Les accusés de lecture — **Lu** — n’existent qu’en RCS.

### SMS Mode

La messagerie envoie par l’API REST de SMS Mode (`https://rest.smsmode.com/sms/v1/messages`),
avec la clé d’API dans l’en-tête `X-Api-Key`. Créez la clé dans l’espace SMS Mode, et nommez sa
variable dans **Secret (variable d’environnement)**.

L’adresse que donne l’aperçu a cette forme :

```text
{CHAT_PUBLIC_URL}/channels/smsmode/<identifiant du numéro>/<clé>
```

- **Chaque message envoyé** la donne lui-même à SMS Mode : pour ce que le client y répond
  (`callbackUrlMo`) et pour dire ce que devient le message (`callbackUrlStatus`, la même suivie
  de `/status`). Rien à régler pour qu’une réponse arrive.
- **Pour un client qui écrit le premier** au numéro, donnez-la aussi comme adresse de réception
  des réponses (MO) dans l’espace SMS Mode, si votre offre le permet.

SMS Mode ne signe pas ses appels : c’est la **clé** de l’adresse — tirée de `CHAT_SECRET`, propre
au numéro — qui les distingue. Un appel sans elle est refusé ; gardez l’adresse pour vous.
Changer `CHAT_SECRET` change la clé : redonnez l’adresse à SMS Mode.

**Expéditeur** remplace le numéro par un nom (`ACME`), sur les téléphones qui l’affichent. Un
client ne peut pas répondre à un nom : laissez-le vide pour une conversation.

:::caution[Ce que SMS Mode envoie]
La messagerie lit les appels de SMS Mode — JSON ou formulaire — avec indulgence : l’identifiant
du message sous `messageId` ou `id`, l’auteur sous `from` ou `originator`, le texte sous
`body.text` ou `text`, l’état sous `status.value` ou `status` (`DELIVERED`, `UNDELIVERABLE`…).
Un appel dont elle ne sait pas dire qui écrit, ou quel message il concerne, est refusé plutôt
que deviné. Essayez votre numéro avant de l’ouvrir à vos clients : un message reçu doit paraître
dans l’inbox, et une réponse passer à **Remis**.
:::

### Un autre fournisseur

Chaque fournisseur est une pièce du serveur qui dit ses identifiants, ses adresses, comment
reconnaître ses appels, ce qu’ils disent et comment envoyer ; le reste de la messagerie ne le
connaît pas. En ajouter un — Vonage, Brevo, Infobip… — est un ajout au code du serveur
(`apps/server/src/channels`) et un choix de plus dans **Fournisseur**.

## Ce que vérifie la messagerie

- **Le fournisseur** : un appel à l’adresse d’un numéro d’un autre fournisseur est refusé.
- **Une seule fois** : un fournisseur rejoue un appel resté sans réponse ; le message n’est écrit
  qu’une fois.
- **Les fichiers** du client sont lus chez Twilio avec le compte du numéro, et suivent les règles
  des pièces jointes : type décidé sur les octets, 10 Mo, cinq par message. Le reste est ignoré.
- **L’ordre** : les réponses d’une conversation partent l’une après l’autre ; une réponse que
  le fournisseur n’a pas pu prendre est réessayée — six fois sur une heure et quart — avant les
  suivantes. Refusée pour de bon, elle est **Non remis**, et les suivantes partent.

## STOP et consentement

Un client qui répond **STOP** ne reçoit plus rien de ce numéro : le fournisseur le gère, et la
messagerie le dit sous chaque réponse — **Non remis**. Les règles d’envoi de SMS commerciaux
(consentement, horaires) restent celles de votre pays, pour un message qu’on écrit le premier
surtout : la messagerie envoie ce qu’on lui demande.

## Dans les automatisations, l’API et les tableaux de bord

- Une conversation par SMS déclenche les [automatisations](/messagerie/fonctionnalites/automatisations/)
  comme une autre ; une étape **Répondre** part sur le téléphone. L’étape **Écrire par SMS ou
  e-mail** écrit au contact d’une autre conversation, et le déclencheur **Message non remis**
  reprend par e-mail un SMS qui n’arrive pas.
- Une réponse envoyée par l’[API REST](/messagerie/integrations/api-rest/) ou le serveur MCP
  aussi. Une conversation y porte `channel` (`web`, `sms`, `rcs`, `email`), et une réponse partie hors du
  widget, `delivery`.
- Les [tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/) lisent le **Canal** de
  chaque conversation : Widget, SMS, RCS ou E-mail.
