---
title: E-mail
description: Une adresse e-mail par site, lue en IMAP et servie en SMTP — les e-mails des clients deviennent des conversations de l’inbox, et les réponses partent de cette adresse, dans le même fil.
---

Un client écrit aussi par **e-mail**, à l’adresse de l’entreprise : `support@exemple.fr`. La
messagerie relève cette boîte ; chaque e-mail ouvre une conversation dans l’inbox, ou continue
celle à laquelle il répond. L’IA y répond la première si le site le veut, un conseiller
reprend, et chaque réponse part de cette adresse, sous le même sujet : le client la lit dans sa
messagerie, et sa réponse revient dans la même conversation (D24).

## Ajouter une adresse

**Administration › Adresses e-mail**, **Nouvelle adresse**. Le formulaire :

| Champ | Ce qu’il dit |
|---|---|
| **Nom** | comment l’inbox la nomme : « Service client — e-mail » |
| **Adresse** | où les clients écrivent, et d’où partent les réponses |
| **Site** | le site dont ses conversations sont : sa boîte de réception, son équipe, son agent IA, sa langue. Aucun : le premier site actif |
| **Serveur SMTP** | par où partent les réponses : `smtp.exemple.fr:465` (TLS), ou `:587` (STARTTLS) |
| **Identifiant** | le compte des deux serveurs. Vide : l’adresse |
| **Mot de passe (variable d’environnement)** | le **nom** de la variable du serveur qui contient le mot de passe — jamais le mot de passe lui-même (D5) |
| **Lire la boîte** | la messagerie relève la boîte chaque minute. Décoché : l’adresse ne sert qu’à envoyer |
| **Serveur IMAP** | où lire ce qui arrive, en TLS : `imap.exemple.fr` (port 993), ou `imap.exemple.fr:1993` |
| **Actif** | désactivée, l’adresse n’est ni lue, ni utilisée |

Puis, sur le serveur, définissez la variable nommée — `SUPPORT_MAIL_PASSWORD=…`, à côté des
autres (voir [variables](/messagerie/hebergement/variables/#adresses-e-mail-des-sites)) — et
relancez-le.

À droite, l’aperçu dit ce qui manque encore, et **Essayer la connexion** ouvre les deux
serveurs avec ce qui est enregistré : « IMAP — répond, et accepte le compte », ou ce qui
cloche — un serveur introuvable, injoignable, un identifiant refusé, une variable absente du
serveur. Le mot de passe n’est jamais renvoyé à l’écran.

:::tip[Gmail, Microsoft 365]
Ces services demandent un **mot de passe d’application** — à créer dans le compte, la
validation en deux étapes activée — plutôt que le mot de passe du compte. Gmail :
`imap.gmail.com` et `smtp.gmail.com:465`. Microsoft 365 : `outlook.office365.com` et
`smtp.office365.com:587`, si l’organisation autorise encore l’authentification par mot de
passe sur ces protocoles.
:::

Une boîte partagée avec des personnes reste possible : la messagerie ne lit que les messages
**non lus** de la boîte de réception, et les marque lus une fois écrits. Une boîte dédiée est
plus sûre.

## Ce que vit le client

- Il écrit à l’adresse. Sa première réponse vient de l’IA, ou d’un conseiller si le site n’a
  pas d’agent IA — comme dans le widget.
- Les réponses arrivent dans sa messagerie, **de l’adresse du site**, au nom du site, sous le
  sujet de son premier e-mail (« Re : … »), mises en forme et signées. Les fichiers d’un
  conseiller partent en pièces jointes.
- Il répond comme à n’importe quel e-mail : sa réponse rejoint la conversation, même si elle
  est passée d’un conseiller à l’autre ; résolue, elle rouvre. Un e-mail qui ne répond à rien
  ouvre une nouvelle conversation.

## Dans l’inbox

- **La liste** marque d’une enveloppe une conversation par e-mail ; le panneau de détails dit
  son **Canal** et l’adresse.
- **Le contact** est retrouvé par son adresse, sur le même site ; un nouveau prend le nom de
  l’expéditeur.
- **Le fil** ne garde que le nouveau texte : la citation de l’e-mail précédent (« Le … a
  écrit : ») est coupée. Les pièces jointes suivent les règles des
  [pièces jointes](/messagerie/fonctionnalites/pieces-jointes/).
- **Sous chaque réponse** : **E-mail en file**, **Envoyé par e-mail**, ou **E-mail non parti**
  — survolé, le motif.

## Ce que la messagerie ignore

Une réponse automatique (absence, accusé de réception), une liste de diffusion, un avis de
non-remise (`mailer-daemon@`) n’ouvrent pas de conversation. Un e-mail relu — la boîte remise
à « non lu » — n’est écrit qu’une fois. Un e-mail vide, sans pièce jointe, est ignoré.

## Avec le widget et « Nouveau message »

- **Le visiteur du widget parti** qui avait laissé son e-mail reçoit les réponses qu’il n’a pas
  vues ([le widget](/messagerie/fonctionnalites/widget/#la-réponse-par-e-mail)). Quand le site a
  son adresse, elles en partent : il peut répondre par e-mail, et sa réponse rejoint la
  conversation du widget.
- **Nouveau message**, par e-mail, depuis un site qui a son adresse, ouvre une conversation par
  e-mail : le client répond depuis sa messagerie. Sans adresse, l’e-mail part du serveur
  (`CHAT_SMTP_URL`) et le client répond en revenant sur le site. Voir
  [Écrire le premier](/messagerie/fonctionnalites/sms-et-rcs/#écrire-le-premier).
- Les [automatisations](/messagerie/fonctionnalites/automatisations/#écrire-par-sms-rcs-ou-e-mail)
  écrivent par e-mail de la même façon, et le déclencheur **Message non remis** permet de
  reprendre par un autre canal un e-mail ou un SMS qui n’arrive pas.

## Dans l’API et les tableaux de bord

- Une conversation porte `channel: "email"` dans l’[API REST](/messagerie/integrations/api-rest/)
  et le serveur MCP ; une réponse, `delivery`.
- Le webhook `message.undelivered` dit une réponse qui n’est pas partie
  ([webhooks](/messagerie/integrations/webhooks/)).
- Les [tableaux de bord](/messagerie/fonctionnalites/tableaux-de-bord/) lisent le **Canal** :
  Widget, SMS, RCS ou E-mail.
