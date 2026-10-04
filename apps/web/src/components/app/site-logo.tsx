'use client'

import { fileUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { SiteItem } from '@chat/contracts'
import { useEffect, useState } from 'react'

/**
 * A site's image: its « Logo », else the icon of its website that the server fetched —
 * and, when neither comes, its initial on its colour.
 */
export function SiteLogo({
  site,
  className,
}: {
  readonly site: SiteItem
  readonly className?: string
}) {
  const [failed, setFailed] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: another image, another try
  useEffect(() => setFailed(false), [site.logo])
  const src = site.logo.startsWith('/') ? fileUrl(site.logo) : site.logo

  if (failed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md font-semibold text-white',
          className,
        )}
        style={{ background: site.color }}
      >
        {site.name.trim().charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-md bg-white object-contain', className)}
    />
  )
}
