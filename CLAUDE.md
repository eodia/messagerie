# Messagerie (nom de travail)

Messagerie client libre, sœur de basedb (`../basedb`). Les décisions qui font autorité sont dans
`docs/architecture/00-decisions-structurantes.md` : citez-les (D1…) plutôt que de les redire.

## Ce qui va dans basedb, ce qui reste ici

- **Paramétrage et référentiel → basedb**, base « Messagerie », décrite par
  `packages/basedb-template/messagerie.json`. Après toute modification du modèle :
  `pnpm template:check`, qui passe par le validateur de basedb, puis `pnpm basedb:setup`,
  qui ajoute les nouveaux champs à une base existante (D3).
- **Flux → schéma `chat`** : contacts, conversations, messages, traces IA, vecteurs.
- Le chat lit basedb par son SDK, jamais en SQL sur les tables `b_…` (D2).
- **Aucun secret dans basedb** : clés de signature des sites, clés des fournisseurs
  d'IA (D5).
  Un outil ou un serveur MCP y nomme la variable d'environnement (`${NOM}`), jamais la valeur.
- **Le paramétrage se fait dans l'inbox, ses données restent dans basedb** (D10) : les
  écrans « Paramétrage » lisent et écrivent la base par l'API, avec le jeton du
  superviseur. Chacun est dans `components/settings/screens`, bâti sur le kit
  `components/settings/kit` (`Studio` : liste, formulaire, aperçu en direct). Un champ
  ajouté à `messagerie.json` qu'un écran ne range pas paraît sous « Autres réglages » :
  rangez-le dans le formulaire et dans `used`.
- Les comptes des conseillers se créent depuis l'inbox (`inbox/accounts.ts`, D4) ; un
  superviseur entre dans le groupe basedb `BASEDB_SUPERVISORS_GROUP`.
- Un réglage du widget ajouté au modèle passe aussi par `settings/widget.ts` (lecture,
  vérification, écriture) et par l'éditeur du widget.
- **Le basedb de développement** tourne dans `docker compose` (http://localhost:8890) :
  `pnpm db:up`, puis `pnpm basedb:setup`. Ne touchez jamais au dépôt `../basedb`.

## L'interface est celle de basedb

- Les tokens de `apps/web/src/styles/globals.css` sont ceux de basedb, valeur pour valeur. Ne
  les changez qu'avec ceux de basedb.
- L'apparence d'une chose (couleur, pictogramme ou image) se choisit avec le `LookButton`
  de basedb (`components/app/look-picker.tsx`), et se dessine avec `components/app/look.tsx`.
- Composants shadcn new-york sur Radix, dans `apps/web/src/components/ui`, repris de basedb :
  - onglets soulignés ;
  - infobulles inversées par `Hint`, jamais un `title` natif ;
  - `Label` en gris.

  Après un `shadcn add`, ramenez le composant à ces conventions, et ne laissez pas la
  commande réécrire `globals.css`.
- **Le vert (`primary`) est réservé à l'action principale et à la sélection.** Les statuts
  utilisent des pastilles teintées : `Chip` dans `components/app/chip.tsx`. Les couleurs
  choisies par quelqu'un (étiquettes) passent par `ColorBadge`.
- Densité de basedb :
  - `text-xs` dans les listes et les barres d'outils ;
  - micro-libellés `text-[11px] font-medium uppercase tracking-wide text-muted-foreground` ;
  - bordures plutôt qu'ombres.

## Textes

- **Tout texte de l'interface s'écrit en français dans `$t('…')`** (`@/lib/i18n`),
  valeurs en `{nom}`.
- Un texte qui dépend d'un nombre passe par `$tp(n, '{count} source', '{count} sources')`.
- Dates et nombres : `Intl` avec `intlLocale()`, jamais `'fr-FR'`.
- Même contrat que basedb, pour reprendre son outillage de traduction le moment venu.
- Code, identifiants et commentaires en anglais.

## Serveur (`apps/server`)

- **Migrations :** le schéma `chat` est décrit par `src/db/schema.ts`.
  `pnpm --filter @chat/server db:generate` écrit la migration dans `drizzle/`. Ne modifiez
  jamais une migration publiée : ajoutez-en une autre. Le serveur migre à chaque démarrage.
- **Écritures :** chaque écriture verrouille la conversation (`for update`) et appelle
  `signalChange` dans sa transaction. Un signal émis hors transaction partirait même si
  l'écriture échouait.
- **Événements :** stockés comme données (`ConversationEvent`), jamais comme phrases.
  Les refus sont des codes (`Refusal`) que l'inbox traduit par `messageFor` (D9 bis).
- **Contrats :** les types échangés vivent dans `packages/contracts`. L'inbox ne connaît
  rien d'autre du schéma.
- `pnpm test:int` lance les tests sur un vrai PostgreSQL (Testcontainers, image
  `pgvector/pgvector:pg16`).
- **Fichiers** (D14) : les octets dans `CHAT_FILES_DIR` (`files/store.ts`), jamais en base ;
  le type se décide sur les octets (`files/attachments.ts`) ; un fichier se lit par un lien
  signé. L'IA ne lit un fichier qu'à la demande d'un conseiller.
- `@chat/ai` se consomme compilé : après une modification, `pnpm --filter @chat/ai build`.
- **API et MCP** (D16) : `src/api`. Un service ouvert aux programmes s'écrit une fois dans
  `api/service.ts` (droits du jeton, boîtes atteintes), puis s'expose en route dans
  `api/rest.ts` et en outil dans `api/mcp.ts`. Un jeton ne supprime jamais rien, et
  n'atteint jamais `/api/inbox`.

## Widget (`apps/widget`)

- Preact dans un Shadow DOM, un seul script (`pnpm --filter @chat/widget build`), que le
  serveur sert à `/widget.js`. Aucune dépendance de la page, aucune police chargée.
- Ce que le site règle arrive en propriétés CSS et en classes sur `.root` (`styles.ts`).
- `data-preview` : le mode aperçu de l'éditeur, nourri par `postMessage` depuis l'origine de
  l'inbox seule (`preview.ts`).
- `window.MessagerieChat` : l'API de la page (`page-api.ts`). Une commande ajoutée l'est
  aussi au panneau de `/demo` et à l'onglet « Installation » de l'éditeur.
