import { $t } from './i18n'

/**
 * A server's code, as a sentence the agent can act on. The
 * server never writes sentences; each code gets its words here, in the reader's language.
 */
export function messageFor(code: string): string {
  switch (code) {
    case 'UNREACHABLE':
      return $t('Le serveur de la messagerie ne répond pas.')
    case 'SESSION_INVALID':
      return $t('Votre session a pris fin : connectez-vous à nouveau.')
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
    case 'DASHBOARD_NOT_FOUND':
      return $t('Ce tableau de bord n’existe plus, ou n’est pas partagé.')
    case 'QUERY_INVALID':
      return $t('Cette question ne peut pas s’exécuter telle quelle.')
    case 'QUERY_TIMEOUT':
      return $t('La question a pris plus de quinze secondes : resserrez-la.')
    case 'SQL_UNAVAILABLE':
      return $t(
        'Les questions en SQL sont indisponibles : la base refuse le rôle de lecture (chat_analytics).',
      )
    case 'AUTOMATION_NOT_FOUND':
      return $t('Cette automatisation n’existe plus.')
    case 'AUTOMATION_INVALID':
      return $t('L’automatisation ne peut pas tourner telle quelle : corrigez l’étape signalée.')
    case 'AUTOMATION_KEY_INVALID':
      return $t('Clé de l’automatisation invalide, ou automatisation arrêtée.')
    case 'TRANSLATION_FAILED':
      return $t(
        'La traduction a échoué : la réponse n’est pas partie. Réessayez, ou envoyez-la sans traduire.',
      )
    case 'WEBHOOK_NOT_FOUND':
      return $t('Ce webhook n’existe plus.')
    case 'WEBHOOK_TARGET_REJECTED':
      return $t('Cette adresse est refusée : HTTPS, vers une adresse publique.')
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
    case 'NOT_ALLOWED':
      return $t('Réservé aux superviseurs.')
    case 'TOOL_NOT_FOUND':
      return $t('Cet outil n’existe plus, ou n’est plus actif.')
    case 'INBOX_NOT_FOUND':
      return $t('Cette boîte de réception n’existe plus, ou n’est plus active.')
    case 'TEAM_NOT_FOUND':
      return $t('Cette équipe n’existe plus, ou ne répond pas dans cette boîte.')
    case 'ROW_NOT_FOUND':
      return $t('Cette ligne n’existe plus : rechargez la page.')
    case 'AGENT_EXISTS':
      return $t('Cette adresse est déjà celle d’un conseiller.')
    case 'CONTACT_NOT_FOUND':
      return $t('Ce contact n’existe plus.')
    case 'NOT_AN_AGENT':
      return $t('Votre compte n’est pas, ou plus, celui d’un conseiller actif.')
    case 'CONVERSATION_NOT_FOUND':
      return $t('Cette conversation n’existe plus, ou n’est pas dans vos boîtes.')
    case 'NOT_SNOOZABLE':
      return $t('Une conversation que l’IA tient, ou déjà résolue, ne se met pas en attente.')
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
