import { msg } from '@/lib/i18n'

/**
 * How the settings screens group and show the tables of the « Messagerie » base. The
 * fields themselves are the template's (the server sends them); this only says which
 * tables go together, which columns the list shows, and what is edited elsewhere.
 */

export interface Group {
  readonly title: string
  /** The tables, in the order of their tabs. */
  readonly tables: readonly string[]
}

export const GROUPS: Readonly<Record<string, Group>> = {
  boites: { title: msg('Boîtes de réception'), tables: ['boites'] },
  equipes: { title: msg('Équipes et conseillers'), tables: ['equipes', 'conseillers'] },
  sites: { title: msg('Sites et horaires'), tables: ['sites', 'horaires', 'fermetures'] },
  reponses: {
    title: msg('Réponses types et étiquettes'),
    tables: ['reponses_types', 'etiquettes'],
  },
  'garde-fous': { title: msg('Garde-fous'), tables: ['garde_fous'] },
  outils: { title: msg('Outils IA'), tables: ['outils_ia', 'serveurs_mcp'] },
  connaissance: { title: msg('Connaissances'), tables: ['articles', 'categories'] },
}

export interface TableView {
  /** The columns of the list, by field label — the first one names the row. */
  readonly columns: readonly string[]
  /** Fields edited on another screen, left out of the form. */
  readonly hidden?: readonly string[]
  /** Where those fields are edited. */
  readonly elsewhere?: { readonly label: string; readonly href: string }
}

/** The widget's words and looks: the widget editor's, with its preview. */
export const WIDGET_FIELDS = [
  'Couleur du widget',
  "Message d'accueil",
  'Questions suggérées',
  "Titre d'accueil",
  "Sous-titre d'accueil",
  'Position du widget',
  'Marge horizontale (px)',
  'Marge verticale (px)',
  'Bouton',
  'Libellé du bouton',
  'Police',
  'Police personnalisée',
  'Thème',
  'Coins',
  'Logo',
  "Masquer l'équipe",
  "Bulle d'accueil après (secondes)",
  'Masquer sur mobile',
  'Masquer hors horaires',
  'Masquer la mention du logiciel',
]

export const VIEWS: Readonly<Record<string, TableView>> = {
  boites: { columns: ['Nom', 'Équipes', 'Équipe par défaut', 'Actif'] },
  equipes: { columns: ['Nom', 'Description'] },
  conseillers: { columns: ['Nom', 'Rôle', 'Équipes', 'Compte basedb', 'Actif'] },
  sites: {
    columns: ['Nom', 'Domaines autorisés', 'Boîte de réception', 'Agent IA actif', 'Actif'],
    hidden: WIDGET_FIELDS,
    elsewhere: { label: msg('Apparence et textes du widget'), href: '/widget' },
  },
  horaires: { columns: ['Créneau', 'Jours', 'Ouverture', 'Fermeture', 'Site'] },
  fermetures: { columns: ['Motif', 'Du', 'Au', 'Site'] },
  reponses_types: { columns: ['Titre', 'Raccourci', 'Équipes'] },
  etiquettes: { columns: ['Nom', 'Couleur', "Posée par l'IA"] },
  garde_fous: { columns: ['Nom', 'Action', 'Équipe', 'Actif'] },
  outils_ia: { columns: ['Nom', 'Type', 'Agent IA', 'Copilote', 'Actif'] },
  serveurs_mcp: { columns: ['Nom', 'Adresse', 'Agent IA', 'Copilote', 'Actif'] },
  articles: { columns: ['Titre', 'Statut', 'Catégorie', 'Sites'] },
  categories: { columns: ['Nom'] },
}

export const viewOf = (table: string): TableView => VIEWS[table] ?? { columns: [] }

/** A field whose text is a colour: a swatch beside it, a picker in the form. */
export const isColorField = (label: string) => /^Couleur/.test(label)
