import { redirect } from 'next/navigation'

/** The statistics became the dashboards (D22): an old link still lands. */
export default function StatisticsPage() {
  redirect('/tableaux-de-bord')
}
