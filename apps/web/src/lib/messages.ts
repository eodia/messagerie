import { $t } from './i18n'

/**
 * A server's code, as a sentence the agent can act on — as basedb's `messageFor`. The
 * server never writes sentences; each code gets its words here, in the reader's language.
 */
export function messageFor(code: string): string {
  switch (code) {
    case 'UNREACHABLE':
      return $t('Le serveur de la messagerie ne répond pas.')
    case 'AUTH_NOT_CONFIGURED':
      return $t(
        'Aucune identité : basedb ne sait pas encore authentifier un conseiller pour la messagerie. En développement, définissez CHAT_DEV_AGENT.',
      )
    case 'NOT_AN_AGENT':
      return $t('Votre compte ne figure pas, actif, dans la table « Conseillers » de basedb.')
    case 'CONVERSATION_NOT_FOUND':
      return $t('Cette conversation n’existe plus.')
    case 'MESSAGE_NOT_FOUND':
      return $t('Ce message n’existe plus.')
    case 'NOT_AN_AI_ANSWER':
      return $t('Seule une réponse de l’IA peut recevoir un avis.')
    case 'EMPTY_MESSAGE':
      return $t('Le message est vide.')
    default:
      return $t('Le serveur a refusé la demande ({code}).', { code })
  }
}
