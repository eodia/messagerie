'use client'

import { cn } from '@/lib/utils'
import type { EChartsOption } from 'echarts'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

/**
 * One chart, drawn by echarts — basedb's: only the pieces the dashboards use, in SVG,
 * following its box's size. The option comes whole from `lib/analytics.ts`.
 */

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  SVGRenderer,
])

export function EChart({
  option,
  className,
  label,
}: {
  readonly option: EChartsOption
  readonly className?: string
  /** What the chart shows, for whoever cannot see it. */
  readonly label?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const element = host.current
    if (element === null) return
    const instance = echarts.init(element, undefined, { renderer: 'svg' })
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(element)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  return (
    <div ref={host} role="img" aria-label={label} className={cn('size-full min-h-0', className)} />
  )
}
