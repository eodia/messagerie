'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { $t } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import type { ToolTestResult } from '@chat/contracts'
import { LoaderCircle, Play } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * A tool's parameters as a form — from its JSON schema: a field per property, its type,
 * its description as the hint, the required ones marked — and what the tool answered.
 */

interface Property {
  readonly name: string
  readonly type: 'string' | 'number' | 'integer' | 'boolean'
  readonly description: string | null
  readonly required: boolean
}

function propertiesOf(schema: Readonly<Record<string, unknown>>): Property[] {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
  return Object.entries(properties).map(([name, spec]) => ({
    name,
    type:
      spec.type === 'number' || spec.type === 'integer' || spec.type === 'boolean'
        ? spec.type
        : 'string',
    description: typeof spec.description === 'string' ? spec.description : null,
    required: required.includes(name),
  }))
}

export interface ToolTarget {
  readonly title: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
}

export function ToolDialog({
  tool,
  onClose,
  run,
  note,
}: {
  readonly tool: ToolTarget | null
  readonly onClose: () => void
  readonly run: (args: Record<string, unknown>) => Promise<ToolTestResult>
  /** Said under the title: where the call leaves its trace, if anywhere. */
  readonly note: string
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ToolTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const properties = tool ? propertiesOf(tool.parameters) : []

  // A new tool starts blank.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tool is the trigger
  useEffect(() => {
    setValues({})
    setResult(null)
    setError(null)
  }, [tool])

  const missing = properties.some((p) => p.required && !(values[p.name] ?? '').trim())

  async function submit() {
    const args: Record<string, unknown> = {}
    for (const property of properties) {
      const raw = (values[property.name] ?? '').trim()
      if (raw === '') continue
      args[property.name] =
        property.type === 'number' || property.type === 'integer'
          ? Number(raw.replace(',', '.'))
          : property.type === 'boolean'
            ? raw === 'true'
            : raw
    }
    setRunning(true)
    setError(null)
    try {
      setResult(await run(args))
    } catch (failure) {
      setError(messageFor((failure as { code?: string }).code ?? 'INTERNAL_ERROR'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open={tool !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{tool?.title}</DialogTitle>
          <DialogDescription>{tool?.description}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{note}</p>

        {properties.length > 0 && (
          <div className="space-y-3">
            {properties.map((property) => (
              <div key={property.name} className="space-y-1.5">
                <label
                  htmlFor={`tool-${property.name}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span className="font-mono text-xs text-foreground">{property.name}</span>
                  {property.required && <span className="text-destructive">*</span>}
                  {property.description && <span className="text-xs">{property.description}</span>}
                </label>
                {property.type === 'boolean' ? (
                  // A choice between two, as two buttons — basedb never uses a native select.
                  <span className="flex gap-1.5">
                    {(['true', 'false'] as const).map((choice) => (
                      <Button
                        key={choice}
                        type="button"
                        size="sm"
                        variant={values[property.name] === choice ? 'secondary' : 'outline'}
                        onClick={() => setValues((all) => ({ ...all, [property.name]: choice }))}
                      >
                        {choice === 'true' ? $t('Oui') : $t('Non')}
                      </Button>
                    ))}
                  </span>
                ) : (
                  <Input
                    id={`tool-${property.name}`}
                    inputMode={property.type === 'string' ? 'text' : 'decimal'}
                    value={values[property.name] ?? ''}
                    onChange={(event) =>
                      setValues((all) => ({ ...all, [property.name]: event.target.value }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {result && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$t('Réponse')} · {result.detail}
            </div>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap scroll-discret">
              {prettify(result.content)}
            </pre>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {$t('Fermer')}
          </Button>
          <Button disabled={missing || running} onClick={() => void submit()}>
            {running ? <LoaderCircle className="animate-spin" /> : <Play />}
            {$t('Lancer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A JSON answer, indented; anything else as it came. */
function prettify(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}
