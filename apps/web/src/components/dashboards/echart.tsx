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

/** A point clicked: its category, its series, where on the screen. */
export interface ChartPoint {
  readonly name: string
  readonly series?: string
  readonly x: number
  readonly y: number
}

export function EChart({
  option,
  className,
  label,
  onPoint,
}: {
  readonly option: EChartsOption
  readonly className?: string
  /** What the chart shows, for whoever cannot see it. */
  readonly label?: string
  readonly onPoint?: (point: ChartPoint) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const pointRef = useRef(onPoint)
  pointRef.current = onPoint

  useEffect(() => {
    const element = host.current
    if (element === null) return
    const instance = echarts.init(element, undefined, { renderer: 'svg' })
    chart.current = instance
    instance.on('click', (params) => {
      const event = (params.event?.event ?? null) as MouseEvent | null
      pointRef.current?.({
        name: String(params.name ?? ''),
        ...(params.seriesName ? { series: params.seriesName } : {}),
        x: event?.clientX ?? 0,
        y: event?.clientY ?? 0,
      })
    })
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
