# Messagerie (nom de travail)

Messagerie client libre, sœur de basedb (`../basedb`). Les décisions qui font autorité sont dans
`docs/architecture/00-decisions-structurantes.md` : citez-les (D1…) plutôt que de les redire.

## Ce qui va dans basedb, ce qui reste ici

- **Paramétrage et référentiel → basedb**, base « Messagerie », décrite par
  `packages/basedb-template/messagerie.json`. Après toute modification du modèle :
  `pnpm template:check`, qui passe par le validateur de basedb.
- **Flux → schéma `chat`** : contacts, conversations, messages, traces IA, vecteurs.
- Le chat lit basedb par son SDK, jamais en SQL sur les tables `b_…` (D2).
- **Aucun secret dans basedb** : clés de signature des sites, clés des fournisseurs
  d'IA (D5).
  Un outil ou un serveur MCP y nomme la variable d'environnement (`${NOM}`), jamais la valeur.
- **Une seule exception d'écran** : l'éditeur du widget, dans l'inbox, pour l'aperçu en
  direct. Il écrit dans la ligne du site, dans basedb, avec le jeton du superviseur (D10).
  Un réglage du widget ajouté au modèle passe aussi par `settings/widget.ts` (lecture,
  vérification, écriture) et par l'éditeur.

## L'interface est celle de basedb

- Les tokens de `apps/web/src/styles/globals.css` sont ceux de basedb, valeur pour valeur. Ne
  les changez qu'avec ceux de basedb.
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

## Widget (`apps/widget`)

- Preact dans un Shadow DOM, un seul script (`pnpm --filter @chat/widget build`), que le
  serveur sert à `/widget.js`. Aucune dépendance de la page, aucune police chargée.
- Ce que le site règle arrive en propriétés CSS et en classes sur `.root` (`styles.ts`).
- `data-preview` : le mode aperçu de l'éditeur, nourri par `postMessage` depuis l'origine de
  l'inbox seule (`preview.ts`).
