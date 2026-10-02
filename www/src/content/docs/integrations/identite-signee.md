---
title: Identité signée
description: Reconnaître un client connecté au site — son serveur signe son identité avec le secret du site, et le widget la transmet.
---

Un visiteur est anonyme jusqu’à ce que **le site dise qui il est, et le prouve**. Le serveur du
site signe l’identité du client connecté avec le **secret du site** ; la page la donne au
widget ; le serveur de la Messagerie vérifie la signature. Le widget n’accepte jamais un
identifiant qui n’est pas signé : ce qu’un script de la page déclare reste une déclaration
(voir l’[API JavaScript](/messagerie/integrations/api-javascript/#identifier-un-visiteur-anonyme)).

## Le secret du site

Chaque site a son secret, qui ne sert qu’à signer les identités de ses clients.

**Il n’est jamais dans le paramétrage** : tout superviseur qui le lit le verrait. Le serveur de
la Messagerie le garde à part, dans sa table `chat.site_secret`, lié à l’identifiant de la ligne
du site (D5). Côté site, il ne quitte pas le serveur : jamais dans la page,
jamais dans un script du navigateur.

Il se crée sur le serveur de la Messagerie, avec la même configuration que lui (`DATABASE_URL`,
`CHAT_SECRET`) :

```bash
pnpm --filter @chat/server site-secret <identifiant du site>
```

La commande affiche le secret du site, et le crée s’il n’en a pas. L’identifiant du site est
celui de sa ligne dans **Administration › Sites et horaires** — la valeur de `data-site` que
donne l’onglet **Installation** de l’éditeur du widget.

```bash
pnpm --filter @chat/server site-secret <identifiant du site> --rotate
```

`--rotate` le remplace : les identités signées avec l’ancien sont refusées **à l’instant**.
Donnez le nouveau au serveur du site dans la foulée.

:::note
Aucun écran de l’inbox ne crée ni n’affiche ce secret : il ne passe que par la commande, sur le
serveur.
:::

## Ce que le serveur du site signe

L’identité est un **JWT signé en HS256** (HMAC-SHA256), avec le secret du site comme clé. C’est le
seul format accepté : un jeton qui annonce un autre algorithme est refusé, `none` en premier.

```json
{
  "sub": "CLI-458732",
  "name": "Sophie Leroy",
  "email": "sophie.leroy@exemple.fr",
  "attributes": {
    "Numéro de contrat": "A123456",
    "Produit": "Assurance Auto"
  },
  "exp": 1790000000
}
```

| Champ | | Rôle |
|---|---|---|
| `sub` | **obligatoire** | L’identifiant du client chez le site, en texte non vide. C’est lui qui retrouve le client d’une visite et d’un appareil à l’autre. |
| `exp` | **obligatoire** | L’échéance, en secondes depuis 1970. Une identité qui n’expire jamais est refusée : ce serait un mot de passe qui traîne. |
| `name` | | Le nom affiché. À défaut, l’e-mail, puis `sub`. |
| `email` | | L’e-mail du client. |
| `attributes` | | Ce que le site veut montrer à l’équipe et à l’IA : son numéro de contrat, son produit, l’état de son dossier. |

Les autres champs (`iat`…) sont ignorés.

### Les attributs

Un objet, `{ "Libellé": "valeur" }`, aux valeurs texte ou nombre. Ou une liste, qui dit en plus
comment montrer chaque valeur :

```json
"attributes": [
  { "label": "Numéro de contrat", "value": "A123456", "kind": "code" },
  { "label": "Statut du dossier", "value": "En cours", "kind": "status" },
  { "label": "Dernier sinistre", "value": "2026-09-12", "kind": "date" },
  { "label": "Produit", "value": "Assurance Auto" }
]
```

| `kind` | Dans l’inbox |
|---|---|
| `text` (par défaut) | le texte |
| `code` | en chasse fixe, avec un bouton pour le copier |
| `status` | une pastille teintée |
| `date` | le jour, écrit dans la langue du conseiller (la valeur au format `AAAA-MM-JJ`) |

Dans la liste, chaque `value` est un texte. Une entrée qui ne suit pas cette forme est ignorée.

## Signer, côté serveur du site

Le jeton se fabrique à chaque page servie au client connecté, puis se pose sur la balise du
widget :

```html
<script src="https://chat.exemple.fr/widget.js" data-site="<identifiant du site>"
        data-identity="<jeton signé par votre serveur>" async></script>
```

Le secret s’emploie **tel quel**, comme une chaîne : ne le décodez pas.

### Node.js

Sans dépendance, avec `node:crypto` :

```js
import { createHmac } from 'node:crypto'

const b64url = (data) => Buffer.from(data).toString('base64url')

/** The customer's identity, signed for the Messagerie widget. */
export function messagerieIdentity(customer) {
  const secret = process.env.MESSAGERIE_SITE_SECRET
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      sub: String(customer.id),
      name: customer.name,
      email: customer.email,
      attributes: { 'Numéro de contrat': customer.contract },
      exp: Math.floor(Date.now() / 1000) + 3600, // one hour
    }),
  )
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}
```

Avec la bibliothèque `jsonwebtoken`, le même jeton :

```js
import jwt from 'jsonwebtoken'

const identity = jwt.sign(
  { sub: String(customer.id), name: customer.name, email: customer.email },
  process.env.MESSAGERIE_SITE_SECRET,
  { algorithm: 'HS256', expiresIn: '1h' },
)
```

### Python

Avec la bibliothèque standard :

```python
import base64
import hashlib
import hmac
import json
import os
import time


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def messagerie_identity(customer: dict) -> str:
    """The customer's identity, signed for the Messagerie widget."""
    secret = os.environ["MESSAGERIE_SITE_SECRET"]
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64url(json.dumps({
        "sub": str(customer["id"]),
        "name": customer["name"],
        "email": customer["email"],
        "attributes": {"Numéro de contrat": customer["contract"]},
        "exp": int(time.time()) + 3600,  # one hour
    }).encode())
    signature = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{b64url(signature)}"
```

Avec PyJWT : `jwt.encode(claims, secret, algorithm="HS256")`, où `claims` porte `sub` et `exp`.

### PHP

```php
function b64url(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/** The customer's identity, signed for the Messagerie widget. */
function messagerie_identity(array $customer): string
{
    $secret = getenv('MESSAGERIE_SITE_SECRET');
    $header = b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $payload = b64url(json_encode([
        'sub' => (string) $customer['id'],
        'name' => $customer['name'],
        'email' => $customer['email'],
        'attributes' => ['Numéro de contrat' => $customer['contract']],
        'exp' => time() + 3600, // one hour
    ]));
    $signature = b64url(hash_hmac('sha256', "$header.$payload", $secret, true));
    return "$header.$payload.$signature";
}
```

### Une page qui connaît l’identité plus tard

Si la balise du widget est écrite avant que la page connaisse le jeton, la page le donne par
`window.MessagerieChat`, **avant** que le script du widget s’exécute :

```html
<script>
  window.MessagerieChat = { identity: '<jeton signé par votre serveur>' }
</script>
```

Cette forme remplace la [file d’attente](/messagerie/integrations/api-javascript/#avant-le-chargement-du-script) :
les commandes s’appellent alors une fois le script chargé. `data-identity`, sur la balise, passe
avant elle.

## Quand l’identité est vérifiée

Le serveur de la Messagerie vérifie l’identité quand le widget ouvre sa session, c’est-à-dire à
chaque page chargée. Il vérifie la signature avec le secret du site, que l’algorithme est HS256,
que `sub` est là et que `exp` n’est pas passé.

Une identité refusée — mauvais secret, site sans secret, jeton expiré, `sub` absent — et **le
widget ne s’affiche pas** sur cette page ; la console du navigateur dit
`Messagerie : IDENTITY_INVALID`.

:::caution[Une page en cache]
Une page servie depuis un cache porte un jeton qui finit par expirer, et le widget disparaît pour
ce client. Signez l’identité à chaque page servie, ou donnez au cache une durée plus courte que
l’échéance du jeton.
:::

## Ce qui change pour le client connecté

**Dans le widget**, l’accueil le salue par son prénom : « Bonjour Sophie », ou le **Titre
d’accueil** du site, où `{prénom}` devient le sien.

**Il est le même client partout.** Le contact est retrouvé par le site et par `sub` : sur son
téléphone puis sur son ordinateur, il retrouve sa conversation. Son nom, son e-mail et ses
attributs sont ceux de la dernière signature reçue.

**Ce qu’il a écrit avant de se connecter le suit.** Un visiteur anonyme qui se connecte au site
emporte ses conversations sur sa fiche de client.

**La page ne peut pas le renommer.** Il garde le nom et l’e-mail de sa signature : `setUser` ne
change plus que son téléphone. Ce que la page joint par `setContactData` ou
`setConversationData` reste déclaré, non vérifié.

**Dans l’inbox**, la conversation porte la mention **Identifié**, et le panneau du contact montre
ses attributs sous **Transmis par le site**, avec un écusson qui dit qu’ils viennent d’une identité
signée. La liste des conversations se filtre sur les **Clients identifiés seulement**.

**L’IA le sait.** Son contexte dit « Client identifié par le site », avec son nom, son e-mail et ses
attributs — masqués quand le modèle est hébergé ailleurs. Un [outil IA](/messagerie/fonctionnalites/outils-ia/)
qui lit la **Fiche du visiteur** lui rend ces attributs ; pour un visiteur anonyme, il répond
qu’il n’y a pas de fiche.

:::caution[À la déconnexion]
Quand le client se déconnecte du site, appelez `MessagerieChat.reset({ visitor: true })`. Le
widget garde un jeton de visiteur dans le navigateur : sans cela, la personne suivante sur le
même ordinateur retrouverait la conversation du client, même sans identité signée.
:::

## En développement

La page de démonstration du serveur de développement, `/demo?client=sophie`, montre le widget
pour Sophie Leroy, cliente connectée : la page signe son identité comme le ferait le serveur d’un
site, avec le secret du site qu’elle crée au besoin.
