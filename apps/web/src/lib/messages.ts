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
        'Le serveur de la messagerie n’est relié à aucun basedb : renseignez BASEDB_API_URL, BASEDB_TENANT, BASEDB_BASE et BASEDB_TOKEN — ou CHAT_DEV_AGENT en développement.',
      )
    case 'SIGNED_OUT':
    case 'SESSION_INVALID':
      return $t(
        'Connectez-vous à basedb dans ce navigateur : la messagerie reconnaît les conseillers par leur compte basedb.',
      )
    case 'BASEDB_UNREACHABLE':
      return $t('basedb ne répond pas : la messagerie ne peut pas vérifier qui vous êtes.')
    case 'SETTINGS_MISMATCH':
      return $t(
        'La base « Messagerie » de basedb ne correspond plus au modèle attendu : une table ou un champ a été renommé.',
      )
    case 'TICKET_INVALID':
      return $t('La connexion en direct a expiré ; elle se rétablit seule.')
    case 'AGENT_NOT_FOUND':
      return $t('Ce conseiller n’est plus actif.')
    case 'ATTACHMENT_REFUSED':
      return $t(
        'Fichier refusé : images, PDF, textes, Word ou Excel, 10 Mo au plus, cinq à la fois.',
      )
    case 'ATTACHMENT_NOT_FOUND':
      return $t('Ce fichier n’existe plus.')
    case 'ATTACHMENT_NOT_ANALYZABLE':
      return $t(
        'L’IA ne sait pas lire ce fichier avec le modèle configuré (images, PDF et textes seulement).',
      )
    case 'SPEECH_UNAVAILABLE':
      return $t('Aucune voix d’IA sur ce serveur : celle du navigateur lit les messages.')
    case 'MESSAGE_NOT_DELETABLE':
      return $t('Ce message ne se supprime pas.')
    case 'TOKEN_INVALID':
      return $t('Ce jeton n’est pas valable.')
    case 'TOKEN_EXPIRED':
      return $t('Ce jeton a expiré.')
    case 'TOKEN_REVOKED':
      return $t('Ce jeton a été révoqué.')
    case 'TOKEN_READ_ONLY':
      return $t('Ce jeton ne permet que la lecture.')
    case 'GIFS_UNAVAILABLE':
      return $t('Les GIF demandent une clé GIPHY sur le serveur (GIPHY_API_KEY).')
    case 'GIFS_UNREACHABLE':
      return $t('GIPHY ne répond pas pour l’instant.')
    case 'GIF_NOT_FOUND':
      return $t('Ce GIF n’est plus disponible.')
    case 'AI_UNAVAILABLE':
      return $t('Aucun modèle d’IA n’est configuré sur le serveur (CHAT_AI_API_KEY).')
    case 'PROMOTION_UNAVAILABLE':
      return $t(
        'Promouvoir une conversation demande basedb, et un jeton de la base « Messagerie » créé en écriture.',
      )
    case 'NOT_ALLOWED':
      return $t('Réservé aux superviseurs.')
    case 'TOOL_NOT_FOUND':
      return $t('Cet outil n’existe plus, ou n’est plus actif.')
    case 'INBOX_NOT_FOUND':
      return $t('Cette boîte de réception n’existe plus, ou n’est plus active.')
    case 'TEAM_NOT_FOUND':
      return $t('Cette équipe n’existe plus, ou ne répond pas dans cette boîte.')
    case 'ROW_NOT_FOUND':
      return $t('Cette ligne n’existe plus dans basedb : rechargez la page.')
    case 'ELEVATION_REQUIRED':
      return $t('Confirmez votre mot de passe pour continuer.')
    case 'ACCOUNTS_ADMIN_REQUIRED':
      return $t(
        'Seul un administrateur de basedb crée des comptes : choisissez plutôt un compte existant.',
      )
    case 'AGENT_EXISTS':
      return $t('Ce compte est déjà celui d’un conseiller.')
    case 'SETTINGS_WRITE_REFUSED':
      return $t(
        'basedb a refusé l’enregistrement : votre compte n’a pas ce droit sur cette table (une suppression demande un administrateur de basedb).',
      )
    case 'CONTACT_NOT_FOUND':
      return $t('Ce contact n’existe plus.')
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
