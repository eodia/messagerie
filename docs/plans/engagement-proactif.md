# Plan — L’engagement proactif ciblé

Aller au-devant du visiteur au bon moment, sur la bonne page : c’est le cœur de l’offre
d’iAdvize (ciblage, « Conversation Starters »). Ce plan dit ce qu’on construit, dans quel
ordre et où dans le code, et ce qu’il faut trancher avant de commencer. Il deviendra une
décision **D23** une fois validé.

## Où l’on part

| Ce qui existe | Où | Ce qu’on en garde |
|---|---|---|
| La **bulle d’accueil** : le message d’accueil à côté du bouton après N secondes, une fois par visite | `settings/widget.ts` (`nudgeAfter`), `apps/widget/src/app.tsx` (`nudgeOf`) | Le rendu (la bulle `Preview`) et la mémoire de session ; la règle unique devient un cas particulier |
| L’**instantané de la page** (`setPageContext`) et le **suivi des pages**, seulement une fois la conversation commencée (D21) | `page-api.ts`, `api.ts` (`popstate`), `page/views.ts` | Le nettoyage des adresses (`cleanPageUrl`), le suivi des navigations d’une application monopage |
| Le **segment** et les **attributs** du contact (identité signée, `setContactData`) | `contact.segment`, `contact.attributes`, `contact.data` | Les conditions de segment |
| Les **horaires** et la disponibilité | `settings/hours.ts`, `WidgetAvailability` | « Seulement si un conseiller peut répondre » |
| Le **moteur de conditions** des automatisations | `automations/subject.ts` (`holds`), `lib/automations.ts` | La forme (`Condition`, `ConditionRule`) et l’éditeur de règles |
| Les **tableaux de bord** (D22) | `analytics/*` | Une vue et un tableau par défaut, comme pour la satisfaction |

Le principe qui contraint tout le reste vient de D21 : **un visiteur qui n’a pas écrit ne
laisse pas de trace** côté serveur. On le garde.

## Le principe : décider dans le navigateur

Les règles d’engagement sont **évaluées par le widget, dans la page**. Le serveur les envoie
avec la session (`WidgetSession.site.engagements`), compilées ; le widget regarde l’adresse,
le temps passé, les pages vues pendant la visite, le nombre de visites, le segment, et décide
seul de montrer une invitation.

- **Pourquoi :** aucune piste de navigation n’est envoyée avant que le visiteur réponde
  (D18, D21), rien à purger, pas de charge serveur par page vue, une réaction immédiate.
- **Ce qui part au serveur :** des compteurs anonymes par règle et par jour — montrée,
  ouverte, conversation commencée — sans visiteur ni adresse. Puis, quand le visiteur répond,
  la conversation porte la règle qui l’a ouverte (`conversation.data`, clé `Engagement`) :
  l’inbox, l’IA, les automatisations et les tableaux de bord la lisent.
- **Le prix :** une règle est lisible par qui ouvre la page (comme le reste du paramétrage du
  widget). Elle ne contient donc jamais rien de secret — ce qui est déjà la règle D5.

## Le modèle

Une table `chat.engagement`, gérée comme les automatisations (JSON vérifié par le serveur),
pas comme une table de paramétrage plate : ses conditions sont des listes.

```ts
// packages/contracts/src/engagements.ts
interface Engagement {
  id, name, active, siteIds: string[] | null       // null : tous les sites
  priority: number                                   // la première qui passe gagne
  condition: Condition                               // la forme des automatisations
  delaySeconds: number                               // après que la condition tient
  action: {
    kind: 'bubble' | 'open'                          // la bulle à côté du bouton, ou le widget ouvert
    message: string                                  // cite {{page.titre}}, {{contact.prenom}}…
    suggestions: string[]                            // les réponses en un clic
    by: 'ai' | 'site' | 'team'                       // qui parle : l’assistant, le site, un conseiller
  }
  capping: { perVisit: 1, everyDays: number, maxPerVisitor: number }
  when: { teamAvailable: boolean, startsOn?, endsOn? }
}
```

Les **champs de condition** propres à l’engagement, lus dans la page :

| Champ | Comparaisons | D’où |
|---|---|---|
| Adresse de la page | contient, commence par, vaut, correspond à (motif `*`) | `location`, nettoyée |
| Temps sur la page, sur le site | plus de N secondes | minuterie du widget |
| Pages vues pendant la visite | plus de N | `sessionStorage` |
| Visite | première, revenu, N-ième | `localStorage` |
| Provenance | référent, `utm_source`, `utm_campaign` | `document.referrer`, l’adresse d’arrivée |
| Défilement | plus de N % de la page | `scroll` |
| Intention de partir | oui | souris vers le haut de la fenêtre, sur ordinateur |
| Appareil | mobile, ordinateur | largeur, `pointer` |
| Segment, donnée du contact | est, contient… | session (`contact.segment`), `setContactData` |
| Contexte de la page | une clé de `setPageContext` : vaut, plus de… | `setPageContext` |
| Événement de la page | `MessagerieChat.trigger('panier_abandonne')` | nouvelle commande de l’API |
| Horaires, disponibilité | ouvert, un conseiller peut répondre | session |

## Ce qu’on construit, par étapes

### Phase 1 — Le socle (une itération)

Le but : remplacer la bulle d’accueil unique par des règles, avec ce qui couvre 80 % des cas.

1. **Contrat et serveur**
   - `packages/contracts` : `Engagement`, `EngagementAction`, les champs ci-dessus ;
     `WidgetSite.engagements` (la forme compilée, sans nom ni auteur).
   - `apps/server/src/engagements/` : `model.ts` (lecture, problèmes — comme
     `automations/model.ts`), `manage.ts` (liste, création, modification, activation,
     superviseurs seuls), `compile.ts` (ce que reçoit le widget, par site).
   - Migration : `chat.engagement`, `chat.engagement_stat (engagement_id, day, shown, opened,
     started)` ; la bulle d’accueil existante d’un site devient sa première règle
     (« Accueil après N secondes »), la colonne `nudge_after` reste lue tant que la
     migration n’est pas faite.
   - Widget : `POST /api/widget/engagements/:id/seen|opened` (compteurs, limités par
     visiteur comme les autres routes) ; la conversation ouverte d’une invitation porte
     `Engagement` dans ses données, et le message d’invitation y est écrit comme premier
     message (`author: 'agent'` de la ligne `engagement:<id>`, signé du site — comme une
     réponse d’automatisation, D20).
2. **Widget** (`apps/widget/src/engagement.ts`) : l’évaluateur — adresse, temps, pages vues,
   visites, appareil, segment, horaires —, le plafonnement (`localStorage`, une par visite,
   tous les N jours), la priorité, l’annulation quand le visiteur ouvre le widget lui-même.
   La bulle actuelle sert de rendu ; `kind: 'open'` ouvre le widget avec le message.
   Budget : 4 Ko de plus au plus.
3. **Inbox** : **Administration › Engagements** (`components/engagements/`) — liste, éditeur
   de règle (l’éditeur de conditions des automatisations, avec les champs de la page), aperçu
   en direct dans le widget (`data-preview`, une nouvelle scène `engagement`), compteurs des
   sept derniers jours. Dans le fil, l’origine se lit : « Ouverte par l’invitation « Devis
   auto — 30 s » ».
4. **Tableaux de bord** : vue `analytics.engagements` (par règle et par jour : montrées,
   ouvertes, conversations, taux) accordée à `chat_analytics` ; une colonne `engagement` dans
   `analytics.conversations` ; une section **Engagement** dans « Vue d’ensemble » (ou un
   tableau donné, comme « Satisfaction »).
5. **Documentation** : `fonctionnalites/engagement.md`, `widget.md` (la bulle d’accueil),
   `parametrage.md` ; `hebergement/variables` si une variable apparaît.

**Fini quand :** un superviseur crée « Page devis, 30 secondes, ordinateur, conseillers
disponibles → ouvrir avec “Une question sur votre devis ?” », la voit dans l’aperçu, et lit
le lendemain combien de visiteurs l’ont vue, ouverte, et combien de conversations en sont nées.

### Phase 2 — Le ciblage fin et la charge de l’équipe

- **Événements de la page :** `MessagerieChat.trigger(nom, données)` — un panier abandonné,
  une erreur de paiement, un formulaire qui bloque ; à ajouter au panneau de `/demo` et à
  l’onglet « Installation » de l’éditeur, comme toute commande (`CLAUDE.md`).
- **Intention de partir, défilement, provenance (UTM, référent).**
- **La charge de l’équipe :** une règle `teamAvailable` ne se montre que si un conseiller de
  l’équipe du site est connecté et sous sa limite de conversations ; le serveur publie la
  disponibilité dans la connexion temps réel du widget, sans dire qui. Un plafond par site :
  N invitations ouvertes à la fois.
- **Automatisations :** un déclencheur « Invitation acceptée » et une condition
  « Engagement » — l’invitation « Devis » va à l’équipe Ventes, avec une priorité haute.
- **Tests A/B :** deux messages pour une règle, partagés au hasard ; le tableau compare.

### Phase 3 — L’accroche écrite par l’IA, et ce que ça rapporte

- **L’accroche de l’IA** (les « Conversation Starters ») : l’option « Laisser l’IA écrire
  l’accroche » génère une phrase et trois réponses en un clic d’après le titre et le contexte
  de la page (`setPageContext`) et la base de connaissance. Générée côté serveur, **mise en
  cache par adresse et par règle** (une page produit = un appel, pas un appel par visiteur),
  tracée (D9, raison `engagement`), relue par un superviseur avant d’être servie si la règle
  le demande.
- **La conversion :** `MessagerieChat.track('commande', { montant: 89 })` rattache une vente
  à la conversation de la visite ; le tableau de bord montre le chiffre d’affaires des
  conversations et des invitations — l’indicateur avec lequel iAdvize se vend.

## Ce qu’il faut trancher avant de commencer

1. **Le consentement (ePrivacy, CNIL).** Le plafonnement et le compte des visites écrivent
   dans le navigateur, pour une fonction que le visiteur n’a pas demandée : c’est probablement
   soumis à consentement. Proposition : un réglage par site **Attendre le consentement**, et
   `MessagerieChat.consent(true)` que le bandeau du site appelle ; sans consentement, seules
   les règles sans mémoire (adresse, temps sur la page) jouent. À valider avec le DPO.
2. **Un écran à part, ou un onglet de l’éditeur du widget ?** Proposition : un écran à part
   (« Engagements »), parce qu’une règle vit avec ses chiffres, et un lien depuis l’éditeur du
   widget, dont la bulle d’accueil devient une règle.
3. **Qui parle dans l’invitation :** l’assistant (quand l’IA est active), le site, ou un
   conseiller nommé (« Léa, de l’équipe Devis ») — ce dernier promet une réponse humaine :
   à réserver aux règles `teamAvailable`.
4. **La migration de la bulle d’accueil :** la convertir en règle (proposé), ou garder les
   deux côte à côte.

## Les risques

- **Agacer le visiteur :** plafonds par défaut stricts (une invitation par visite, une tous
  les sept jours pour une même règle), aucune sur mobile sans l’avoir choisi, jamais pendant
  une conversation en cours.
- **Noyer l’équipe :** `teamAvailable` coché par défaut pour `by: 'team'`, plafond par site.
- **Le poids du widget :** l’évaluateur est petit, mais l’éditeur de motifs d’adresse ne doit
  pas embarquer de bibliothèque ; un motif `*` suffit.
- **Mesurer ce qui n’est pas la règle :** le compteur « conversation commencée » ne vaut que
  pour une conversation née de l’invitation (le premier message après elle, dans la visite).

## L’estimation

| Phase | Charge | Livre |
|---|---|---|
| 1 — Le socle | 8 à 10 jours | règles, éditeur, aperçu, compteurs, tableau, docs |
| 2 — Le ciblage fin | 6 à 8 jours | événements de page, sortie, UTM, charge, automatisations, A/B |
| 3 — L’IA et la conversion | 6 à 8 jours | accroches générées et mises en cache, `track`, chiffre d’affaires |
