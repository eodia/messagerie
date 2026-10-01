'use client'

import { CopyButton } from '@/components/app/copy-button'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'
import { api, fileUrl } from '@/lib/api'
import { $t, intlLocale } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { clockTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Attachment, AttachmentAnalysis } from '@chat/contracts'
import {
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'

/**
 * The files of a message: images as pictures, the rest as cards to open or download. Each
 * can be read by the AI on request — what it is, what it says that matters, what is
 * missing — and what it found stays under the file, for the whole team.
 */

export function sizeLabel(bytes: number): string {
  const megabytes = bytes >= 1024 * 1024
  return new Intl.NumberFormat(intlLocale(), {
    style: 'unit',
    unit: megabytes ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: megabytes ? 1 : 0,
  }).format(megabytes ? bytes / (1024 * 1024) : Math.max(1, bytes / 1024))
}

export function iconOf(mime: string) {
  if (mime.startsWith('image/')) return FileImage
  if (mime === 'application/pdf' || mime.startsWith('text/plain')) return FileText
  if (mime.includes('spreadsheet') || mime === 'text/csv') return FileSpreadsheet
  return File
}

/** What a reader calls the file's kind. */
function kindOf(mime: string, name: string): string {
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('image/')) return $t('Image')
  return (name.split('.').pop() ?? '').toUpperCase()
}

const analyzable = (mime: string) =>
  mime.startsWith('image/') || mime === 'application/pdf' || mime.startsWith('text/')

export function AttachmentList({
  items,
  align = 'left',
}: {
  readonly items: readonly Attachment[]
  readonly align?: 'left' | 'right'
}) {
  if (items.length === 0) return null
  const images = items.filter((a) => a.mime.startsWith('image/'))
  const others = items.filter((a) => !a.mime.startsWith('image/'))
  return (
    <div className={cn('mt-1.5 flex flex-col gap-1.5', align === 'right' && 'items-end')}>
      {images.length > 0 && (
        <div className={cn('grid gap-1.5', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {images.map((image) => (
            <div key={image.id} className="space-y-1.5">
              <a
                href={fileUrl(image.url)}
                target="_blank"
                rel="noreferrer"
                className="group block overflow-hidden rounded-xl border bg-muted/40"
              >
                <img
                  src={fileUrl(image.url)}
                  alt={image.name}
                  loading="lazy"
                  className="max-h-64 w-full max-w-72 object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </a>
              <Analysis attachment={image} />
            </div>
          ))}
        </div>
      )}
      {others.map((file) => {
        const Icon = iconOf(file.mime)
        return (
          <div key={file.id} className="w-72 max-w-full space-y-1.5">
            <a
              href={fileUrl(file.url)}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 rounded-xl border bg-background px-3 py-2.5 transition-colors hover:bg-muted/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-4.5 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{file.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {kindOf(file.mime, file.name)} · {sizeLabel(file.size)}
                </span>
              </span>
              <Download className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
            <Analysis attachment={file} />
          </div>
        )
      })}
    </div>
  )
}

/** The AI's reading of a file — or the button that asks for it. */
function Analysis({ attachment }: { readonly attachment: Attachment }) {
  const [analysis, setAnalysis] = useState<AttachmentAnalysis | null>(attachment.analysis)
  const [busy, setBusy] = useState(false)
  const shown = attachment.analysis ?? analysis

  if (!shown) {
    if (!analyzable(attachment.mime)) return null
    return (
      <Hint label={$t('Le fichier est envoyé au modèle d’IA de la messagerie, qui le décrit.')}>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={async () => {
            setBusy(true)
            try {
              setAnalysis((await api.analyzeAttachment(attachment.id)).analysis)
            } catch (error) {
              useInbox.getState().fail(error)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5 text-violet-600 dark:text-violet-300" />
          )}
          {busy ? $t('L’IA lit le fichier…') : $t('Analyser avec l’IA')}
        </Button>
      </Hint>
    )
  }

  return (
    <div className="group w-full max-w-sm rounded-xl border border-violet-500/25 bg-violet-500/[0.04] text-left">
      <div className="flex items-center gap-1.5 border-b border-violet-500/15 px-3 py-1.5">
        <Sparkles className="size-3.5 text-violet-600 dark:text-violet-300" />
        <span className="flex-1 text-[11px] font-medium text-violet-800 dark:text-violet-300">
          {$t('Lu par l’IA')}
        </span>
        <CopyButton
          text={shown.summary}
          label={$t('Copier l’analyse')}
          className="opacity-60 group-hover:opacity-100"
        />
      </div>
      <div className="space-y-1 px-3 py-2 text-xs leading-relaxed whitespace-pre-line">
        {shown.summary}
      </div>
      <div className="px-3 pb-2 text-[10px] text-muted-foreground">
        {$t('Demandée par {name} · {time}', { name: shown.by, time: clockTime(shown.at) })}
      </div>
    </div>
  )
}
