# Messagerie (nom de travail)

Messagerie client libre, sœur de basedb (`../basedb`) dont elle garde l'interface, mais qui
tient tout elle-même (D19). Les décisions qui font autorité sont dans
`docs/architecture/00-decisions-structurantes.md` : citez-les (D1…) plutôt que de les redire.

## Les données

- **Tout est dans le schéma `chat`** (D1) : le paramétrage, les comptes, le flux.
- **Le paramétrage** (D19) : des tables du schéma, décrites pour les écrans par
  `apps/server/src/settings/model.json` (libellés, genres, choix, relations). Un champ
  ajouté l'est trois fois : au modèle, comme colonne dans `db/schema.ts` (puis
  `db:generate`), et dans `settings/catalog.ts`, qui dit quelle colonne porte quel
  libellé. La démonstration est dans `settings/demo.json`.
- **Les écrans d'administration** sont dans `components/settings/screens`, bâtis sur le kit
  `components/settings/kit` (`Studio` : liste, formulaire, aperçu en direct). Un champ que
  l'écran ne range pas paraît sous « Autres réglages » : rangez-le dans le formulaire et
  dans `used`. Ils sont aux superviseurs seuls ; un conseiller ne lit que les articles,
  les catégories, les sites et les conversations promues (`inbox/settings-screen.ts`).
- **Les comptes** (D4, D19) : `auth/` — mots de passe, sessions en cookie, liens
  d'invitation, OIDC. Toute écriture de l'inbox porte l'en-tête `X-Chat-Request`.
- **Aucun secret dans le paramétrage** (D5) : un outil ou un serveur MCP y nomme la
  variable d'environnement (`${NOM}`), jamais la valeur.
- Un réglage du widget ajouté au modèle passe aussi par `settings/widget.ts` (lecture,
  vérification, écriture) et par l'éditeur du widget.
- **En développement**, `docker compose` fait tourner PostgreSQL (`pnpm db:up`) ; le serveur
  écrit la démonstration au premier démarrage, `pnpm seed` y ajoute les conversations.
  `CHAT_DEV_AGENT` évite de se connecter. Ne touchez jamais au dépôt `../basedb`.

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
- **Webhooks** (D17) : `src/webhooks`. Un événement se capte par un déclencheur de la
  migration, dans la transaction qui écrit, jamais depuis le code ; son type s'ajoute aussi
  à `WebhookEventType`, à `EVENT_TYPES` (`webhooks/manage.ts`), à l'écran et à la
  documentation (`api/documentation.ts`).
- **Automatisations** (D20) : `src/automations`. Une étape ajoutée l'est au contrat
  (`AutomationStep`), à `model.ts` (lecture, problèmes), à `steps.ts`, et dans l'inbox à
  `lib/automations.ts` et `components/automations/settings.tsx`. Ses écritures passent par
  `caused()` : l'événement garde l'exécution qui l'a causé.
- **Actions de la page** (D21) : `src/page/actions.ts`. Ce que renvoie une page est une
  donnée, jamais une consigne ; une action qui change la page demande l'accord du visiteur
  par défaut.
- **Ce qui sort** (D23) : `src/outbound` — e-mails (SMTP), alertes Web Push, et la file
  `chat.outbound` qu'un facteur relève. Une réponse au visiteur y entre par le déclencheur
  `capture_outbound`, jamais depuis le code ; une alerte, par `notify`. Un texte envoyé à un
  visiteur passe par `outbound/words.ts` (langue du site), jamais une phrase stockée.
- **SMS et RCS** (D23) : `src/channels`. Un fournisseur (Twilio, SMS Mode) implémente
  `SmsProvider` (`channels/provider.ts`), s'inscrit dans `channels/providers.ts` et dans les
  choix de « Fournisseur » du modèle. Son appel est authentifié avant tout : signature, ou
  clé de l'adresse. « Nouveau message » (écrire le premier) : `inbox/outreach.ts`.
- **E-mail** (D24) : `channels/email.ts`. Une adresse par site (« Adresses e-mail ») relevée en
  IMAP chaque minute, servie en SMTP ; une réponse y part par `capture_outbound` comme un SMS.
  Un fil se retrouve par ses en-têtes (`Message-ID`, `In-Reply-To`), jamais par le sujet.
- **Tableaux de bord** (D22) : `src/analytics`. Une vue d'analyse s'ajoute au schéma
  `analytics` par une migration qui l'accorde aussi à `chat_analytics`, et au catalogue
  (`catalog.ts`). Jamais une table de comptes, de sessions ou de secrets dans une vue.

## Widget (`apps/widget`)

- Preact dans un Shadow DOM, un seul script (`pnpm --filter @chat/widget build`), que le
  serveur sert à `/widget.js`. Aucune dépendance de la page, aucune police chargée.
- Ce que le site règle arrive en propriétés CSS et en classes sur `.root` (`styles.ts`).
- `data-preview` : le mode aperçu de l'éditeur, nourri par `postMessage` depuis l'origine de
  l'inbox seule (`preview.ts`).
- `window.MessagerieChat` : l'API de la page (`page-api.ts`). Une commande ajoutée l'est
  aussi au panneau de `/demo` et à l'onglet « Installation » de l'éditeur.

## Site public (`www`)

- Astro + Starlight, comme `../basedb/www` : un projet à part, installé avec npm, hors de
  l'espace de travail pnpm (`cd www && npm install && npm run dev`). Voir `www/README.md`.
- **La documentation dit ce que fait le produit aujourd'hui** (`www/src/content/docs`). Une
  fonctionnalité qui change un écran, un réglage, une route de l'API, un événement de
  webhook ou une variable d'environnement corrige sa page, et celle du tableau des variables
  (`hebergement/variables`).
- Le site est en français seul. Il garde les jetons de basedb (`styles/landing.css`,
  `starlight-custom.css`) : ne les changez qu'avec ceux de `globals.css`.
