import type { AutomationChoices } from '@chat/contracts'
import type { Draft } from './automations'
import { $t, msg } from './i18n'

/**
 * What a team often wants first, ready to adjust: each a draft, saved off — the
 * supervisor reads it, fills what is theirs (a team, an inbox), then switches it on.
 */

export interface Template {
  readonly key: string
  readonly name: string
  readonly hint: string
  readonly make: (choices: AutomationChoices | null) => Draft
}

const none = { match: 'all' as const, rules: [] }

export const TEMPLATES: readonly Template[] = [
  {
    key: 'ask-email',
    name: msg('Demander l’e-mail quand la réponse tarde'),
    hint: msg(
      'Après 5 minutes sans réponse, le widget propose au visiteur de laisser son adresse.',
    ),
    make: () => ({
      name: $t('Demander l’e-mail quand la réponse tarde'),
      description: $t('Personne n’a répondu depuis 5 minutes : on garde un moyen de répondre.'),
      trigger: { kind: 'no_reply', minutes: 5 },
      condition: { match: 'all', rules: [{ field: 'identified', op: 'no', values: [] }] },
      steps: [
        {
          id: 's1',
          kind: 'ask_email',
          text: $t(
            'Nos conseillers sont occupés. Laissez votre e-mail : nous vous répondons dès que possible.',
          ),
        },
      ],
    }),
  },
  {
    key: 'survey',
    name: msg('Enquête de satisfaction à la résolution'),
    hint: msg(
      'Une conversation résolue : le widget demande au visiteur une note de 1 à 5, et un mot s’il le souhaite.',
    ),
    make: () => ({
      name: $t('Enquête de satisfaction à la résolution'),
      description: $t(
        'Les notes alimentent le tableau de bord « Satisfaction », au global et par conseiller.',
      ),
      trigger: { kind: 'resolved' },
      condition: none,
      steps: [{ id: 's1', kind: 'survey', scale: 'csat', text: '' }],
    }),
  },
  {
    key: 'bad-score',
    name: msg('Alerter sur une mauvaise note'),
    hint: msg(
      'Une note de 1 ou 2 sur 5 : les superviseurs sont prévenus, avec le commentaire du visiteur.',
    ),
    make: () => ({
      name: $t('Alerter sur une mauvaise note'),
      description: '',
      trigger: { kind: 'survey_answered' },
      condition: { match: 'all', rules: [{ field: 'score', op: 'less_than', values: ['3'] }] },
      steps: [
        { id: 's1', kind: 'tag', add: [$t('Insatisfait')], remove: [] },
        {
          id: 's2',
          kind: 'notify',
          to: 'supervisors',
          agentIds: [],
          text: $t(
            '{{contact.nom}} a donné {{enquete.note}}/{{enquete.sur}} à {{conversation.conseiller}} : {{enquete.commentaire}}',
          ),
        },
      ],
    }),
  },
  {
    key: 'follow-up',
    name: msg('Relancer un visiteur silencieux'),
    hint: msg(
      '24 heures après la réponse d’un conseiller, une relance — sauf s’il a écrit entre-temps.',
    ),
    make: () => ({
      name: $t('Relancer un visiteur silencieux'),
      description: '',
      trigger: { kind: 'assigned' },
      condition: { match: 'all', rules: [{ field: 'assignee', op: 'not_empty', values: [] }] },
      steps: [
        { id: 's1', kind: 'wait', amount: 24, unit: 'hours', unlessReply: true },
        {
          id: 's2',
          kind: 'reply',
          body: $t(
            'Bonjour {{contact.prenom}}, avez-vous pu avancer ? Nous restons à votre disposition.',
          ),
        },
        { id: 's3', kind: 'wait', amount: 2, unit: 'days', unlessReply: true },
        { id: 's4', kind: 'status', status: 'resolved' },
      ],
    }),
  },
  {
    key: 'unhappy',
    name: msg('Escalader les clients mécontents'),
    hint: msg('Une humeur négative passe en priorité haute, et les superviseurs sont prévenus.'),
    make: () => ({
      name: $t('Escalader les clients mécontents'),
      description: '',
      trigger: { kind: 'sentiment_changed' },
      condition: { match: 'all', rules: [{ field: 'sentiment', op: 'is', values: ['negative'] }] },
      steps: [
        { id: 's1', kind: 'priority', priority: 'high' },
        { id: 's2', kind: 'tag', add: [$t('Réclamation')], remove: [] },
        {
          id: 's3',
          kind: 'notify',
          to: 'supervisors',
          agentIds: [],
          text: $t('{{contact.nom}} semble mécontent : à reprendre vite.'),
        },
      ],
    }),
  },
  {
    key: 'round-robin',
    name: msg('Répartir à tour de rôle'),
    hint: msg('Ce que l’IA transfère va aux membres d’une équipe, chacun son tour.'),
    make: (choices) => ({
      name: $t('Répartir à tour de rôle'),
      description: '',
      trigger: { kind: 'handed_off' },
      condition: none,
      steps: [
        {
          id: 's1',
          kind: 'assign',
          to: 'round_robin',
          ...(choices?.teams[0] ? { teamId: choices.teams[0].id } : {}),
        },
      ],
    }),
  },
  {
    key: 'after-hours',
    name: msg('Hors horaires : prévenir et étiqueter'),
    hint: msg(
      'Une conversation qui commence site fermé reçoit un mot, et l’étiquette « À rappeler ».',
    ),
    make: () => ({
      name: $t('Hors horaires'),
      description: '',
      trigger: { kind: 'handed_off' },
      condition: { match: 'all', rules: [{ field: 'hours', op: 'closed', values: [] }] },
      steps: [
        { id: 's1', kind: 'tag', add: [$t('À rappeler')], remove: [] },
        { id: 's2', kind: 'ask_email', text: '' },
      ],
    }),
  },
  {
    key: 'close-stale',
    name: msg('Clore les conversations en attente depuis 7 jours'),
    hint: msg('Chaque matin, ce qui dort depuis une semaine est résolu.'),
    make: (choices) => ({
      name: $t('Clore les conversations en attente'),
      description: '',
      trigger: {
        kind: 'schedule',
        forEach: true,
        schedule: {
          every: 'day',
          at: '07:00',
          weekday: 1,
          timezone: choices?.sites[0]?.timezone ?? 'Europe/Paris',
        },
      },
      condition: {
        match: 'all',
        rules: [
          { field: 'status', op: 'is', values: ['pending', 'open'] },
          { field: 'idle', op: 'more_than', values: ['10080'] },
        ],
      },
      steps: [
        { id: 's1', kind: 'note', body: $t('Close automatiquement après 7 jours sans message.') },
        { id: 's2', kind: 'status', status: 'resolved' },
      ],
    }),
  },
  {
    key: 'triage',
    name: msg('Trier par sujet avec l’IA'),
    hint: msg('L’IA classe la première demande, puis la conversation part vers la bonne boîte.'),
    make: (choices) => ({
      name: $t('Trier par sujet'),
      description: '',
      trigger: { kind: 'conversation_created' },
      condition: none,
      steps: [
        {
          id: 's1',
          kind: 'ai',
          mode: 'classify',
          prompt: $t('Quel est le sujet de la demande du visiteur ?'),
          choices: [$t('Sinistre'), $t('Contrat'), $t('Autre')],
        },
        {
          id: 's2',
          kind: 'branch',
          paths: [
            {
              id: 'p1',
              label: $t('Sinistre'),
              otherwise: false,
              condition: {
                match: 'all',
                rules: [{ field: 'step', key: 's1', op: 'equals', values: [$t('Sinistre')] }],
              },
              steps: [
                {
                  id: 's3',
                  kind: 'transfer',
                  ...(choices?.inboxes[1] ? { inboxId: choices.inboxes[1].id } : {}),
                },
              ],
            },
            {
              id: 'p2',
              label: $t('Sinon'),
              otherwise: true,
              condition: none,
              steps: [{ id: 's4', kind: 'tag', add: [$t('Contrat')], remove: [] }],
            },
          ],
        },
      ],
    }),
  },
]
