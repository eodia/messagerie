import type { AnalyticsSource } from '@chat/contracts'

/**
 * What a question may read (D22): the views of the `analytics` schema, their columns in the
 * words of the people who ask. The builder offers these alone; a SQL question reads them as
 * `chat_analytics`, which sees nothing else.
 */

const STATUSES = [
  { value: 'ai', label: 'Avec l’IA' },
  { value: 'open', label: 'Ouverte' },
  { value: 'pending', label: 'En attente' },
  { value: 'resolved', label: 'Résolue' },
]
const PRIORITIES = [
  { value: 'low', label: 'Basse' },
  { value: 'normal', label: 'Normale' },
  { value: 'high', label: 'Haute' },
  { value: 'urgent', label: 'Urgente' },
]
const SENTIMENTS = [
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutre' },
  { value: 'negative', label: 'Négative' },
]
const AUTHORS = [
  { value: 'contact', label: 'Visiteur' },
  { value: 'ai', label: 'IA' },
  { value: 'agent', label: 'Conseiller' },
  { value: 'system', label: 'Système' },
]
const VERDICTS = [
  { value: 'accepted', label: 'Acceptée' },
  { value: 'edited', label: 'Modifiée' },
  { value: 'rejected', label: 'Rejetée' },
]
const RUN_STATUSES = [
  { value: 'queued', label: 'En file' },
  { value: 'running', label: 'En cours' },
  { value: 'waiting', label: 'En attente' },
  { value: 'succeeded', label: 'Réussie' },
  { value: 'failed', label: 'Échouée' },
  { value: 'stopped', label: 'Arrêtée' },
]

export const SOURCES: readonly AnalyticsSource[] = [
  {
    key: 'conversations',
    label: 'Conversations',
    description: 'Une ligne par conversation : où elle est arrivée, qui l’a traitée, comment.',
    columns: [
      { name: 'created_at', label: 'Commencée le', type: 'date' },
      { name: 'status', label: 'Statut', type: 'text', values: STATUSES },
      { name: 'inbox', label: 'Boîte de réception', type: 'text' },
      { name: 'team', label: 'Équipe', type: 'text' },
      { name: 'site', label: 'Site', type: 'text' },
      { name: 'priority', label: 'Priorité', type: 'text', values: PRIORITIES },
      { name: 'sentiment', label: 'Humeur', type: 'text', values: SENTIMENTS },
      { name: 'assignee', label: 'Conseiller', type: 'text' },
      { name: 'identified', label: 'Client identifié', type: 'boolean' },
      { name: 'country', label: 'Pays', type: 'text' },
      { name: 'ai_answered', label: 'L’IA a répondu', type: 'boolean' },
      { name: 'agent_answered', label: 'Un conseiller a répondu', type: 'boolean' },
      { name: 'handed_off', label: 'Transférée par l’IA', type: 'boolean' },
      { name: 'resolved_by_ai', label: 'Résolue par l’IA', type: 'boolean' },
      { name: 'first_response_seconds', label: 'Première réponse (s)', type: 'number' },
      { name: 'messages', label: 'Messages', type: 'number' },
      { name: 'last_message_at', label: 'Dernier message le', type: 'date' },
    ],
  },
  {
    key: 'messages',
    label: 'Messages',
    description: 'Ce qui s’est dit : par le visiteur, l’IA, les conseillers ; les notes.',
    columns: [
      { name: 'created_at', label: 'Envoyé le', type: 'date' },
      { name: 'author', label: 'Auteur', type: 'text', values: AUTHORS },
      {
        name: 'kind',
        label: 'Type',
        type: 'text',
        values: [
          { value: 'text', label: 'Message' },
          { value: 'note', label: 'Note' },
          { value: 'file', label: 'Fichier' },
          { value: 'handoff', label: 'Transfert' },
        ],
      },
      { name: 'agent', label: 'Conseiller', type: 'text' },
      { name: 'inbox', label: 'Boîte de réception', type: 'text' },
      { name: 'deleted', label: 'Supprimé', type: 'boolean' },
    ],
  },
  {
    key: 'ai_runs',
    label: 'Appels à l’IA',
    description: 'Chaque appel au modèle : sa raison, sa confiance, sa durée, ce qu’il a coûté.',
    columns: [
      { name: 'created_at', label: 'Le', type: 'date' },
      {
        name: 'kind',
        label: 'Raison',
        type: 'text',
        values: [
          { value: 'answer', label: 'Réponse au visiteur' },
          { value: 'suggestion', label: 'Suggestion' },
          { value: 'tag', label: 'Étiquettes et humeur' },
          { value: 'summary', label: 'Résumé' },
          { value: 'rephrase', label: 'Reformulation' },
          { value: 'attachment', label: 'Pièce jointe' },
          { value: 'speech', label: 'Voix' },
          { value: 'automation', label: 'Automatisation' },
        ],
      },
      { name: 'model', label: 'Modèle', type: 'text' },
      { name: 'confidence', label: 'Confiance', type: 'number' },
      { name: 'latency_ms', label: 'Durée (ms)', type: 'number' },
      { name: 'prompt_tokens', label: 'Jetons lus', type: 'number' },
      { name: 'completion_tokens', label: 'Jetons écrits', type: 'number' },
    ],
  },
  {
    key: 'ai_feedback',
    label: 'Avis sur l’IA',
    description: 'Ce que les conseillers ont fait des réponses et suggestions de l’IA.',
    columns: [
      { name: 'created_at', label: 'Le', type: 'date' },
      { name: 'verdict', label: 'Avis', type: 'text', values: VERDICTS },
      { name: 'agent', label: 'Conseiller', type: 'text' },
      { name: 'run_kind', label: 'Sur', type: 'text' },
    ],
  },
  {
    key: 'tags',
    label: 'Étiquettes',
    description: 'Les étiquettes posées sur les conversations, par un conseiller ou par l’IA.',
    columns: [
      { name: 'label', label: 'Étiquette', type: 'text' },
      {
        name: 'origin',
        label: 'Posée par',
        type: 'text',
        values: [
          { value: 'agent', label: 'Conseiller' },
          { value: 'ai', label: 'IA' },
        ],
      },
      { name: 'created_at', label: 'Posée le', type: 'date' },
      { name: 'conversation_created_at', label: 'Conversation commencée le', type: 'date' },
      { name: 'inbox', label: 'Boîte de réception', type: 'text' },
    ],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    description: 'Les visiteurs et clients qui ont écrit.',
    columns: [
      { name: 'created_at', label: 'Venu le', type: 'date' },
      { name: 'identified', label: 'Client identifié', type: 'boolean' },
      { name: 'country', label: 'Pays', type: 'text' },
      { name: 'segment', label: 'Segment', type: 'text' },
      { name: 'has_email', label: 'A laissé son e-mail', type: 'boolean' },
    ],
  },
  {
    key: 'automation_runs',
    label: 'Exécutions d’automatisations',
    description: 'Ce que les automatisations ont fait, et comment cela s’est passé.',
    columns: [
      { name: 'created_at', label: 'Le', type: 'date' },
      { name: 'automation', label: 'Automatisation', type: 'text' },
      { name: 'trigger', label: 'Déclencheur', type: 'text' },
      { name: 'status', label: 'Statut', type: 'text', values: RUN_STATUSES },
      { name: 'seconds', label: 'Durée (s)', type: 'number' },
    ],
  },
]

export const sourceOf = (key: string): AnalyticsSource | undefined =>
  SOURCES.find((s) => s.key === key)
