import { $t } from '@/lib/i18n'

/**
 * How a thing looks — basedb's rules (`lib/options.ts`): a colour of any hue, and either
 * a pictogram of the interface's library or a small picture, never both.
 */

/** Mirrors basedb's ceiling: a picture is a URL, and every read of the row carries it. */
export const MAX_IMAGE_CHARS = 16_384

/** `#abc` and `#AABBCC` both become `#aabbcc`; anything else is not a colour. */
export function normalizeHex(text: string): string | null {
  const t = text.trim()
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return null
  const hex = t.slice(1).toLowerCase()
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`
}

/** A starting point, not a limit: the picker takes any colour. */
export const PRESET_COLORS: readonly string[] = [
  '#dc2626',
  '#ea580c',
  '#d97706',
  '#ca8a04',
  '#65a30d',
  '#16a34a',
  '#0d9488',
  '#0891b2',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#db2777',
  '#6b7280',
]

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error($t('Image illisible.')))
    image.src = url
  })
}

/**
 * Turns a picked file into a small data URL, or refuses it.
 *
 * The picture is stored in the row and travels with every read of it, so it has to stay
 * small: the file is drawn onto a canvas at most 64 pixels on a side (then 48, then 32 if
 * it still does not fit) and re-encoded. A vector image comes out rasterised, which is
 * also what keeps a script out of it.
 */
export async function shrinkImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error($t('Ce fichier n’est pas une image.'))
  const url = URL.createObjectURL(file)
  try {
    const image = await load(url)
    const width = image.naturalWidth > 0 ? image.naturalWidth : 64
    const height = image.naturalHeight > 0 ? image.naturalHeight : 64

    for (const side of [64, 48, 32]) {
      const scale = Math.min(1, side / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (context === null) throw new Error($t('Image illisible.'))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)

      for (const [type, quality] of [
        ['image/webp', 0.85],
        ['image/png', undefined],
      ] as const) {
        const data = canvas.toDataURL(type, quality)
        // A browser that cannot encode WebP answers with a PNG: only a match is kept.
        if (data.startsWith(`data:${type}`) && data.length <= MAX_IMAGE_CHARS) return data
      }
    }
    throw new Error($t('Image trop détaillée : choisissez-en une plus simple.'))
  } finally {
    URL.revokeObjectURL(url)
  }
}
