import {
  agentTeams,
  agents,
  aiTools,
  articleSites,
  articles,
  cannedReplies,
  cannedReplyTeams,
  categories,
  closures,
  guardrails,
  inboxTeams,
  inboxes,
  mcpServers,
  openingSlots,
  promotedConversations,
  sites,
  smsNumbers,
  tagDefinitions,
  teams,
} from '../db/schema.js'

/**
 * How each settings table is stored (D19): the screens and `Settings` speak in field
 * LABELS — the model's (`model.json`) —, the database in columns. A field added to the
 * model is added here, and as a column of its table in `db/schema.ts`.
 */

export type FieldStore =
  | { readonly kind: 'column'; readonly column: string; readonly role?: true }
  | { readonly kind: 'link'; readonly column: string; readonly target: string }
  | { readonly kind: 'join'; readonly join: string; readonly target: string }
  // biome-ignore lint/suspicious/noExplicitAny: a Drizzle table of any shape
  | { readonly kind: 'count'; readonly table: any; readonly column: string }

export interface TableStore {
  readonly key: string
  readonly label: string
  // biome-ignore lint/suspicious/noExplicitAny: a Drizzle table of any shape
  readonly table: any
  readonly fields: Readonly<Record<string, FieldStore>>
  /** People, not programs: the integration tokens' rows are not agents to set up. */
  readonly agents?: true
}

/** The join tables: their Drizzle table, the owner's column, the target's. */
export const JOINS = {
  inbox_team: { table: inboxTeams, owner: 'inboxId', target: 'teamId' },
  agent_team: { table: agentTeams, owner: 'agentId', target: 'teamId' },
  canned_reply_team: { table: cannedReplyTeams, owner: 'cannedReplyId', target: 'teamId' },
  article_site: { table: articleSites, owner: 'articleId', target: 'siteId' },
} as const

export const STORES: readonly TableStore[] = [
  {
    key: 'sites',
    label: 'Sites',
    table: sites,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      'Domaines autorisés': { kind: 'column', column: 'domains' },
      "Message d'accueil": { kind: 'column', column: 'welcome' },
      'Questions suggérées': { kind: 'column', column: 'suggestions' },
      'Couleur du widget': { kind: 'column', column: 'color' },
      "Titre d'accueil": { kind: 'column', column: 'title' },
      "Sous-titre d'accueil": { kind: 'column', column: 'tagline' },
      'Position du widget': { kind: 'column', column: 'position' },
      'Marge horizontale (px)': { kind: 'column', column: 'offsetX' },
      'Marge verticale (px)': { kind: 'column', column: 'offsetY' },
      Bouton: { kind: 'column', column: 'launcher' },
      'Libellé du bouton': { kind: 'column', column: 'launcherLabel' },
      Police: { kind: 'column', column: 'font' },
      'Police personnalisée': { kind: 'column', column: 'customFont' },
      Thème: { kind: 'column', column: 'theme' },
      Coins: { kind: 'column', column: 'corners' },
      Logo: { kind: 'column', column: 'logo' },
      "Masquer l'équipe": { kind: 'column', column: 'hideTeam' },
      "Bulle d'accueil après (secondes)": { kind: 'column', column: 'nudgeAfter' },
      'Masquer sur mobile': { kind: 'column', column: 'hideOnMobile' },
      'Masquer hors horaires': { kind: 'column', column: 'hideWhenClosed' },
      'Masquer la mention du logiciel': { kind: 'column', column: 'hideBranding' },
      Langue: { kind: 'column', column: 'language' },
      'Fuseau horaire': { kind: 'column', column: 'timeZone' },
      'Agent IA actif': { kind: 'column', column: 'aiEnabled' },
      'Seuil de confiance (%)': { kind: 'column', column: 'aiThreshold' },
      "Consignes de l'agent IA": { kind: 'column', column: 'aiInstructions' },
      'Conservation (jours)': { kind: 'column', column: 'retentionDays' },
      'Répondre par e-mail': { kind: 'column', column: 'emailReplies' },
      Actif: { kind: 'column', column: 'active' },
      'Boîte de réception': { kind: 'link', column: 'inboxId', target: 'boites' },
      'Équipe par défaut': { kind: 'link', column: 'defaultTeamId', target: 'equipes' },
    },
  },
  {
    key: 'horaires',
    label: "Horaires d'ouverture",
    table: openingSlots,
    fields: {
      Créneau: { kind: 'column', column: 'label' },
      Jours: { kind: 'column', column: 'days' },
      Ouverture: { kind: 'column', column: 'opens' },
      Fermeture: { kind: 'column', column: 'closes' },
      Site: { kind: 'link', column: 'siteId', target: 'sites' },
    },
  },
  {
    key: 'fermetures',
    label: 'Fermetures exceptionnelles',
    table: closures,
    fields: {
      Motif: { kind: 'column', column: 'reason' },
      Du: { kind: 'column', column: 'startsOn' },
      Au: { kind: 'column', column: 'endsOn' },
      'Message aux visiteurs': { kind: 'column', column: 'message' },
      Site: { kind: 'link', column: 'siteId', target: 'sites' },
    },
  },
  {
    key: 'boites',
    label: 'Boîtes de réception',
    table: inboxes,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      Description: { kind: 'column', column: 'description' },
      Couleur: { kind: 'column', column: 'color' },
      Pictogramme: { kind: 'column', column: 'icon' },
      Image: { kind: 'column', column: 'image' },
      Actif: { kind: 'column', column: 'active' },
      Équipes: { kind: 'join', join: 'inbox_team', target: 'equipes' },
      'Équipe par défaut': { kind: 'link', column: 'defaultTeamId', target: 'equipes' },
    },
  },
  {
    key: 'equipes',
    label: 'Équipes',
    table: teams,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      Description: { kind: 'column', column: 'description' },
      Conseillers: { kind: 'count', table: agentTeams, column: 'teamId' },
    },
  },
  {
    key: 'conseillers',
    label: 'Conseillers',
    table: agents,
    agents: true,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      'E-mail': { kind: 'column', column: 'email' },
      Rôle: { kind: 'column', column: 'role', role: true },
      'Conversations simultanées': { kind: 'column', column: 'maxConversations' },
      Actif: { kind: 'column', column: 'active' },
      Équipes: { kind: 'join', join: 'agent_team', target: 'equipes' },
    },
  },
  {
    key: 'reponses_types',
    label: 'Réponses types',
    table: cannedReplies,
    fields: {
      Titre: { kind: 'column', column: 'title' },
      Raccourci: { kind: 'column', column: 'shortcut' },
      Contenu: { kind: 'column', column: 'body' },
      Équipes: { kind: 'join', join: 'canned_reply_team', target: 'equipes' },
    },
  },
  {
    key: 'etiquettes',
    label: 'Étiquettes',
    table: tagDefinitions,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      Couleur: { kind: 'column', column: 'color' },
      "Quand l'appliquer": { kind: 'column', column: 'whenToApply' },
      "Posée par l'IA": { kind: 'column', column: 'byAi' },
    },
  },
  {
    key: 'categories',
    label: 'Catégories',
    table: categories,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      Description: { kind: 'column', column: 'description' },
      Articles: { kind: 'count', table: articles, column: 'categoryId' },
    },
  },
  {
    key: 'articles',
    label: 'Articles',
    table: articles,
    fields: {
      Titre: { kind: 'column', column: 'title' },
      Contenu: { kind: 'column', column: 'body' },
      Statut: { kind: 'column', column: 'status' },
      Auteur: { kind: 'column', column: 'authorId' },
      'Relu le': { kind: 'column', column: 'reviewedOn' },
      Catégorie: { kind: 'link', column: 'categoryId', target: 'categories' },
      Sites: { kind: 'join', join: 'article_site', target: 'sites' },
    },
  },
  {
    key: 'conversations_promues',
    label: 'Conversations promues',
    table: promotedConversations,
    fields: {
      Question: { kind: 'column', column: 'question' },
      Réponse: { kind: 'column', column: 'answer' },
      Statut: { kind: 'column', column: 'status' },
      Origine: { kind: 'column', column: 'origin' },
      Conversation: { kind: 'column', column: 'conversationUrl' },
      'Promue par': { kind: 'column', column: 'promotedBy' },
      'Relue par': { kind: 'column', column: 'reviewedBy' },
      Catégorie: { kind: 'link', column: 'categoryId', target: 'categories' },
    },
  },
  {
    key: 'garde_fous',
    label: 'Garde-fous',
    table: guardrails,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      Sujet: { kind: 'column', column: 'subject' },
      Action: { kind: 'column', column: 'action' },
      'Message au visiteur': { kind: 'column', column: 'message' },
      Actif: { kind: 'column', column: 'active' },
      Équipe: { kind: 'link', column: 'teamId', target: 'equipes' },
    },
  },
  {
    key: 'outils_ia',
    label: 'Outils IA',
    table: aiTools,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      "Description pour l'IA": { kind: 'column', column: 'description' },
      Type: { kind: 'column', column: 'kind' },
      Cible: { kind: 'column', column: 'target' },
      Méthode: { kind: 'column', column: 'method' },
      "Jeton (variable d'environnement)": { kind: 'column', column: 'tokenEnv' },
      'En-têtes': { kind: 'column', column: 'headers' },
      Paramètres: { kind: 'column', column: 'parameters' },
      'Agent IA': { kind: 'column', column: 'forAi' },
      Copilote: { kind: 'column', column: 'forCopilot' },
      Actif: { kind: 'column', column: 'active' },
    },
  },
  {
    key: 'serveurs_mcp',
    label: 'Serveurs MCP',
    table: mcpServers,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      Adresse: { kind: 'column', column: 'url' },
      Description: { kind: 'column', column: 'description' },
      "Jeton (variable d'environnement)": { kind: 'column', column: 'tokenEnv' },
      'En-têtes': { kind: 'column', column: 'headers' },
      'Outils autorisés': { kind: 'column', column: 'allowedTools' },
      'Agent IA': { kind: 'column', column: 'forAi' },
      Copilote: { kind: 'column', column: 'forCopilot' },
      Actif: { kind: 'column', column: 'active' },
    },
  },
  {
    key: 'numeros_sms',
    label: 'Numéros SMS',
    table: smsNumbers,
    fields: {
      Nom: { kind: 'column', column: 'name' },
      Numéro: { kind: 'column', column: 'phone' },
      Fournisseur: { kind: 'column', column: 'provider' },
      'Identifiant du compte': { kind: 'column', column: 'accountSid' },
      "Jeton (variable d'environnement)": { kind: 'column', column: 'tokenEnv' },
      'Service de messagerie': { kind: 'column', column: 'messagingServiceSid' },
      Expéditeur: { kind: 'column', column: 'sender' },
      Site: { kind: 'link', column: 'siteId', target: 'sites' },
      Actif: { kind: 'column', column: 'active' },
    },
  },
]
