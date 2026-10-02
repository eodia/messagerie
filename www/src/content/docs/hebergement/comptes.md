---
title: Comptes et connexion
description: Le premier superviseur, les invitations par lien, les mots de passe, les sessions, et la connexion par le fournisseur d’identité de l’entreprise (OpenID Connect).
---

La messagerie tient elle-même les comptes de ses conseillers (D4, D19). Un conseiller est une
ligne de « Conseillers », qui est à la fois sa fiche et son compte : il se connecte avec son
adresse e-mail et son mot de passe, ou par le fournisseur d’identité de l’entreprise —
Microsoft Entra, Google, Keycloak… Les visiteurs du widget, eux, n’ont jamais de compte.

## Le premier superviseur

À la première mise en service, la base est vide : personne ne peut se connecter. L’écran de
connexion devient alors **Bienvenue dans la messagerie** — « Premier lancement : créez le
compte du premier superviseur. Il invitera les autres conseillers. » On y donne :

- un **Nom** ;
- une **Adresse e-mail** ;
- un **Mot de passe**, tapé deux fois.

**Créer le compte** crée le superviseur et le connecte. L’écran de connexion redevient
ordinaire dès qu’un superviseur actif peut se connecter, par mot de passe ou par le fournisseur
d’identité.

:::caution
Tant que ce superviseur n’existe pas, quiconque atteint l’inbox peut le créer : faites-le dès le
premier démarrage. Si plus aucun superviseur actif ne peut se connecter — tous désactivés, par
exemple —, l’écran revient ; une adresse qui est déjà celle d’un conseiller retrouve alors sa
fiche, nommée superviseur, avec ce nouveau mot de passe.
:::

## Inviter un conseiller

Un superviseur invite depuis **Administration › Équipes et conseillers**, onglet
**Conseillers**, bouton **Inviter un conseiller**. On donne son **Nom**, son **Adresse
e-mail**, son **Rôle** et ses **Équipes**, puis **Inviter**.

1. Sa fiche est créée aussitôt, active.
2. Un **lien à transmettre** s’affiche, avec **Copier** : « Il ne s’affichera plus, et vaut
   sept jours, une seule fois : transmettez-le maintenant. »
3. La personne ouvre le lien — **Bienvenue, Camille** —, choisit son mot de passe, puis
   **Rejoindre la messagerie** : elle est connectée.

La messagerie n’envoie aucun e-mail : le lien se transmet par le canal de votre choix. Il a la
forme `https://support.exemple.fr/invitation/…`, l’adresse de l’inbox (`CHAT_WEB_ORIGIN`). Un
lien qui a servi, qui a expiré ou dont le conseiller a été désactivé affiche **Lien
inutilisable**. Une adresse qui est déjà celle d’un conseiller est refusée : « Cette adresse est
déjà celle d’un conseiller. »

Avec un fournisseur d’identité, le conseiller invité peut aussi ignorer le lien et se connecter
directement par lui, avec la même adresse.

## Mot de passe oublié

Il n’y a pas de lien « mot de passe oublié » qui parte par e-mail. Sous le formulaire de
connexion, **Première connexion, mot de passe oublié ?** l’explique : un superviseur redonne un
lien.

Sur la fiche du conseiller, section **Connexion** — « Mot de passe oublié, ou jamais choisi :
un lien pour en choisir un. » —, **Créer un lien**, puis **Créer le lien**. C’est un lien de
même sorte que l’invitation : sept jours, une fois. Il mène à **Nouveau mot de passe** ; une
fois le mot de passe choisi, les autres sessions du conseiller sont fermées. Un nouveau lien
annule le précédent, s’il n’a pas servi.

:::tip
Nommez au moins deux superviseurs : si l’un oublie son mot de passe, l’autre lui redonne un
lien.
:::

Chacun change aussi le sien depuis son menu, en bas de la barre latérale : **Changer mon mot de
passe** demande le **Mot de passe actuel**, puis le nouveau, deux fois. Ses autres sessions
sont fermées. Un conseiller qui n’a jamais choisi de mot de passe — il se connecte par le
fournisseur d’identité — en obtient un par un lien.

## Les règles du mot de passe

- **Huit caractères au moins**, deux cents au plus.
- **Pas l’adresse e-mail** du compte.

Pendant la saisie, une jauge dit sa force — **Faible**, **Correct**, **Fort** — d’après sa
longueur et ce qu’il mêle : minuscules, majuscules, chiffres, autres signes. C’est un conseil :
le serveur ne refuse que ce qui est trop court, ou l’adresse.

Le serveur le garde en **scrypt**, jamais en clair. Un refus le dit : « Ce mot de passe ne
convient pas : 8 caractères au moins, et pas votre adresse. »

## Les sessions

Se connecter ouvre une **session**, que le serveur pose dans un cookie :

| | |
|---|---|
| Nom | `chat_session`, pour le nom du serveur (`CHAT_PUBLIC_URL`) |
| `HttpOnly` | aucun script de la page ne le lit |
| `SameSite=Lax` | une page d’un autre site ne l’envoie pas avec ses requêtes |
| `Secure` | quand `CHAT_PUBLIC_URL` commence par `https:` |
| Durée | trente jours |

La base ne garde de la session qu’une empreinte (SHA-256) : une sauvegarde ne permet pas de se
connecter. Le navigateur oublie le cookie trente jours après la connexion, et le serveur efface
une session restée trente jours sans servir. Une mise à jour ou un redémarrage ne déconnecte
personne.

Une session prend fin :

- par **Se déconnecter**, dans le menu du conseiller : elle est effacée ;
- quand le conseiller choisit un nouveau mot de passe : toutes ses autres sessions sont fermées ;
- quand il est désactivé : ses sessions sont refusées dans les secondes qui suivent.

L’inbox revient alors à l’écran de connexion.

Parce que le cookie est celui du serveur, l’inbox et le serveur doivent partager un site :
deux sous-domaines du même domaine (voir [Mise en production](/messagerie/hebergement/production/#deux-sous-domaines-dun-même-domaine)).

### L’en-tête `X-Chat-Request`

Chaque écriture de l’inbox — et chaque appel `POST` de la connexion — porte l’en-tête
`X-Chat-Request`. Une page d’un autre site ne peut pas l’ajouter sans que CORS l’y autorise, et
CORS n’autorise que l’origine de l’inbox (`CHAT_WEB_ORIGIN`). Sans lui, la requête est refusée,
même avec un cookie valable. C’est la protection contre les requêtes forgées par un autre site.

Une passerelle doit laisser passer cet en-tête. Un programme, lui, ne passe pas par là : il
prend un jeton de l’[API REST](/messagerie/integrations/api-rest/).

## Les limites d’essais

Pour freiner qui devine un mot de passe, le serveur compte les essais sur un quart d’heure
glissant :

- **dix par adresse e-mail** — la connexion, le changement de mot de passe ;
- **trente par adresse IP** — toutes les opérations de la connexion : se connecter, créer le
  premier superviseur, ouvrir ou utiliser un lien, partir chez le fournisseur d’identité.

Au-delà : « Trop d’essais : patientez un quart d’heure avant de recommencer. » Une adresse
inconnue et un mauvais mot de passe reçoivent la même réponse, dans le même temps : « Adresse
ou mot de passe incorrect. »

Derrière une passerelle, l’adresse IP est lue dans `X-Forwarded-For` si `CHAT_TRUST_PROXY=1` ;
sinon, toutes les connexions sembleraient venir de la passerelle.

## Les rôles

Chaque conseiller a un rôle, sur sa fiche :

| Rôle | Ce qu’il fait |
|---|---|
| **Conseiller** | voit les boîtes de ses équipes, répond, transfère |
| **Superviseur** | voit tout, réaffecte, et règle le paramétrage : le menu **Administration** |

Un rôle changé vaut dans les secondes qui suivent, sans nouvelle connexion. Qui voit quoi est détaillé dans
[Conseillers et droits](/messagerie/fonctionnalites/conseillers-et-droits/).

## Désactiver plutôt que supprimer

Un conseiller n’est jamais supprimé : ses messages gardent son nom. **Retirer le conseiller**,
sur sa fiche, puis **Confirmer la suppression**, le **désactive** : sa fiche reste, marquée
**Désactivé**. Il ne peut plus se connecter, ni par mot de passe, ni par lien, ni par le
fournisseur d’identité, et ses sessions ouvertes sont refusées.

Pour le réactiver, cochez **Actif** sur sa fiche, sous **Autres réglages**.

## OpenID Connect

À côté du mot de passe, la messagerie connecte un conseiller par le fournisseur d’identité de
l’entreprise, en OpenID Connect (flux « code » avec PKCE). L’écran de connexion ajoute alors,
sous le formulaire, **Continuer avec Microsoft** — le nom vient de `CHAT_OIDC_NAME`.

**Il ne crée personne.** Le fournisseur connecte le conseiller **déjà invité** dont l’adresse
e-mail est la sienne. La première fois, la messagerie retient son identité chez le fournisseur
(l’émetteur et l’identifiant `sub`) : ensuite, elle le reconnaît par elle, même si son adresse
change. Une adresse que le fournisseur déclare non vérifiée (`email_verified` à `false`) n’est
pas prise. Un compte qui n’est pas celui d’un conseiller actif revient sur l’écran de
connexion : « Ce compte n’est pas celui d’un conseiller actif de la messagerie. »

### Les variables

| Variable | Rôle |
|---|---|
| `CHAT_OIDC_ISSUER` | l’émetteur ; le serveur lit sa description à `/.well-known/openid-configuration` |
| `CHAT_OIDC_CLIENT_ID` | l’identifiant du client déclaré chez le fournisseur |
| `CHAT_OIDC_CLIENT_SECRET` | son secret ; vide pour un client public |
| `CHAT_OIDC_NAME` | le nom sur le bouton : `Microsoft`, `Google`… (`SSO` par défaut) |

Le bouton ne paraît que si `CHAT_OIDC_ISSUER` et `CHAT_OIDC_CLIENT_ID` sont définis.

L’**adresse de retour** à déclarer chez le fournisseur est celle du serveur :

```text
{CHAT_PUBLIC_URL}/api/auth/oidc/callback
```

soit `https://chat.exemple.fr/api/auth/oidc/callback` dans l’exemple de la
[mise en production](/messagerie/hebergement/production/). La messagerie demande les portées
`openid email profile`.

### Microsoft Entra ID

1. Dans le centre d’administration Microsoft Entra, **Inscriptions d’applications › Nouvelle
   inscription**. Type de compte : ceux de votre organisation seulement.
2. **URI de redirection** : plateforme **Web**, l’adresse de retour ci-dessus.
3. Notez l’**ID d’application (client)** et l’**ID de l’annuaire (locataire)**.
4. **Certificats et secrets › Nouveau secret client** ; copiez sa valeur.

```bash
CHAT_OIDC_ISSUER=https://login.microsoftonline.com/<ID du locataire>/v2.0
CHAT_OIDC_CLIENT_ID=<ID d’application>
CHAT_OIDC_CLIENT_SECRET=<valeur du secret>
CHAT_OIDC_NAME=Microsoft
```

Entra ne met l’adresse dans le jeton (`email`) que si le compte en a une : c’est elle qui doit
être celle de l’invitation.

### Google

1. Dans la console Google Cloud, **API et services › Écran de consentement OAuth** : type
   **Interne** pour un domaine Google Workspace.
2. **Identifiants › Créer des identifiants › ID client OAuth**, type **Application Web**.
3. **URI de redirection autorisés** : l’adresse de retour ci-dessus.

```bash
CHAT_OIDC_ISSUER=https://accounts.google.com
CHAT_OIDC_CLIENT_ID=<…>.apps.googleusercontent.com
CHAT_OIDC_CLIENT_SECRET=<secret du client>
CHAT_OIDC_NAME=Google
```

### Keycloak

1. Dans le royaume de l’entreprise, **Clients › Create client**, type **OpenID Connect**.
2. **Client authentication** activé, **Standard flow** coché.
3. **Valid redirect URIs** : l’adresse de retour ci-dessus.
4. Onglet **Credentials** : le secret du client.

```bash
CHAT_OIDC_ISSUER=https://sso.exemple.fr/realms/<royaume>
CHAT_OIDC_CLIENT_ID=messagerie
CHAT_OIDC_CLIENT_SECRET=<secret du client>
CHAT_OIDC_NAME=Keycloak
```

Keycloak déclare si l’adresse d’un utilisateur est vérifiée : une adresse non vérifiée n’est pas
prise.

### Mettre en service

Ajoutez les variables à `.env`, puis relancez la messagerie (`docker compose up -d`). Le journal
le dit : `chat : connexion par Microsoft (https://login.microsoftonline.com/…/v2.0)`. Le serveur
ne lit la description du fournisseur qu’au premier clic sur le bouton : essayez-le aussitôt.
S’il ne peut pas la lire, le bouton mène à une réponse brute, `{"code":"SSO_FAILED"}`. Une
adresse de retour mal déclarée, c’est le fournisseur qui la refuse, sur sa propre page. Si
l’échange échoue au retour — un secret erroné, par exemple —, l’écran de
connexion affiche « La connexion par votre fournisseur d’identité a échoué. », et le journal du
serveur en donne la raison (`chat : connexion OIDC refusée …`).

Le premier superviseur se crée toujours avec un mot de passe ; il se connecte ensuite par le
fournisseur comme les autres, avec la même adresse.

## En développement

Sur un poste de développement, se connecter à chaque redémarrage lasse vite. `CHAT_DEV_AGENT`
nomme, par son adresse e-mail, le conseiller actif au nom duquel le serveur répond aux requêtes
de l’inbox **sans session** : l’inbox s’ouvre directement. Le modèle `apps/server/.env.example`
y met le superviseur de la démonstration, `marc.jamain@exemple.fr`. Une session ouverte passe
avant.

Avec `NODE_ENV=production`, `CHAT_DEV_AGENT` est ignoré : une requête sans session est refusée.
