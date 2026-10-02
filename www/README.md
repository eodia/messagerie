# Messagerie — le site

Le site public de la Messagerie, logiciel libre d’[Eodia](https://eodia.com/fr/) et frère de
[basedb](https://eodia.github.io/basedb/) : la page d’accueil et la documentation.
[Astro](https://astro.build) et [Starlight](https://starlight.astro.build), en français seul,
avec le style du site de basedb. Publié sur GitHub Pages sous
`https://eodia.github.io/messagerie/`.

Ce dossier est un projet à part : il n’appartient pas à l’espace de travail pnpm du dépôt et
s’installe avec npm.

```bash
cd www
npm install
npm run dev       # http://localhost:4321/messagerie/
npm run build     # le site statique dans dist/
npm run check     # vérification des types
```

## Où est quoi

| Chemin | Contenu |
|---|---|
| `src/views/Home.astro` | la page d’accueil, assemblée à partir de `src/components/home/` ; sa FAQ |
| `src/components/home/` | les scènes de l’accueil : l’inbox (`Inbox`), le widget (`Widget`), l’IA qui répond (`Agent`), le copilote, la grille de l’inbox, le paramétrage dans basedb, l’éditeur du widget (`Studio`), les intégrations, le prix |
| `src/components/landing/` | la barre, le pied de page, le logo, les pictogrammes (`icons.ts`) |
| `src/content/docs/` | la documentation (Markdown), une page par fichier |
| `src/styles/landing.css` | les jetons de couleur et de typographie, ceux de basedb |
| `src/styles/home.css` | ce que partagent les sections de l’accueil, repris du site de basedb |
| `src/styles/app.css` | l’application dessinée : les jetons de l’inbox, ses pastilles, ses avatars |
| `src/styles/starlight-custom.css` | le thème de la documentation |
| `src/lib/site.ts` | le nom du produit, l’adresse du dépôt, celle de basedb |
| `src/lib/motion.ts` | les scènes qui jouent pendant qu’elles sont à l’écran, repris de basedb |
| `astro.config.mjs` | l’adresse du site et la barre latérale de la documentation |

## L’application dessinée

L’accueil ne montre pas de captures : il dessine l’inbox et le widget en HTML, avec leurs vrais
libellés (les chaînes `$t('…')` de `apps/web`) et les personnes de la démonstration (Acme
Assurances). Les scènes jouent tant qu’elles sont à l’écran ; sans JavaScript, ou quand le
lecteur demande moins de mouvement, elles montrent leur état final. Un libellé qui change dans
l’inbox change aussi ici.

## La documentation

Elle dit ce que fait le produit aujourd’hui : une fonctionnalité qui change un écran, un réglage,
une route de l’API, un événement de webhook ou une variable d’environnement corrige sa page, et
le tableau des variables (`hebergement/variables`). Les liens internes s’écrivent avec la base :
`/messagerie/fonctionnalites/inbox/`.

## Publier

Le workflow `.github/workflows/deploy-www.yml` construit et publie le site sur GitHub Pages, à la
main (« Run workflow ») ou en poussant une étiquette `www-v*`.
