import { createHash } from 'node:crypto'
import { type Llm, passages } from '@chat/ai'
import { and, cosineDistance, eq, notInArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { kbChunks } from '../db/schema.js'
import type { Settings } from '../settings/settings.js'

/**
 * What the AI answers from: the published articles and promoted conversations of basedb,
 * cut into passages and embedded in `chat.kb_chunk` (pgvector).
 *
 * A sync compares each source's digest with the one indexed: only what changed is embedded
 * again, and what was unpublished or deleted leaves the index — an answer never cites an
 * article nobody can read any more.
 */

const DIMENSIONS = 1024

export interface Found {
  readonly source: 'article' | 'conversation'
  readonly sourceId: string
  readonly title: string
  readonly text: string
  /** 1 is the same meaning; below 0.5, hardly related. */
  readonly similarity: number
}

interface Source {
  readonly kind: 'article' | 'conversation'
  readonly id: string
  readonly title: string
  readonly text: string
  readonly siteIds: readonly string[]
}

export class Knowledge {
  constructor(
    private readonly db: Db,
    private readonly settings: Settings,
    private readonly llm: Llm,
  ) {}

  private async sources(): Promise<Source[]> {
    const [articles, promoted] = await Promise.all([
      this.settings.articles(),
      this.settings.promotedConversations(),
    ])
    return [
      ...articles.map((a) => ({
        kind: 'article' as const,
        id: a.id,
        title: a.title,
        text: a.content,
        siteIds: a.siteIds,
      })),
      ...promoted.map((p) => ({
        kind: 'conversation' as const,
        id: p.id,
        title: p.question,
        text: `Question : ${p.question}\n\nRéponse : ${p.answer}`,
        siteIds: [],
      })),
    ]
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const vectors = await this.llm.embed(texts)
    const wrong = vectors.find((v) => v.length !== DIMENSIONS)
    if (wrong) {
      throw new Error(
        `Le modèle d’embeddings ${this.llm.embeddingModel} donne ${wrong.length} dimensions ; le schéma en attend ${DIMENSIONS}.`,
      )
    }
    return vectors
  }

  /** Brings the index in line with basedb. */
  async sync(): Promise<{ indexed: number; removed: number; kept: number }> {
    const sources = await this.sources()
    const indexed = await this.db
      .selectDistinct({
        source: kbChunks.source,
        sourceId: kbChunks.sourceId,
        digest: kbChunks.digest,
      })
      .from(kbChunks)
    const digestOf = new Map(indexed.map((r) => [`${r.source}:${r.sourceId}`, r.digest]))

    let count = 0
    let kept = 0
    for (const source of sources) {
      const digest = createHash('sha256')
        .update(
          `${this.llm.embeddingModel}\n${source.title}\n${source.text}\n${source.siteIds.join(',')}`,
        )
        .digest('hex')
      if (digestOf.get(`${source.kind}:${source.id}`) === digest) {
        kept++
        continue
      }
      const cut = passages(source.title, source.text)
      const vectors = await this.embed(cut.map((p) => `${p.title}\n\n${p.text}`))
      await this.db.transaction(async (tx) => {
        await tx
          .delete(kbChunks)
          .where(and(eq(kbChunks.source, source.kind), eq(kbChunks.sourceId, source.id)))
        if (cut.length === 0) return
        await tx.insert(kbChunks).values(
          cut.map((passage, index) => ({
            source: source.kind,
            sourceId: source.id,
            title: passage.title,
            text: passage.text,
            embedding: vectors[index] ?? null,
            digest,
            siteIds: [...source.siteIds],
          })),
        )
      })
      count++
    }

    // What basedb no longer publishes.
    let removed = 0
    for (const kind of ['article', 'conversation'] as const) {
      const live = sources.filter((s) => s.kind === kind).map((s) => s.id)
      const gone = await this.db
        .delete(kbChunks)
        .where(
          and(
            eq(kbChunks.source, kind),
            live.length > 0 ? notInArray(kbChunks.sourceId, live) : undefined,
          ),
        )
        .returning({ id: kbChunks.id })
      removed += gone.length
    }
    return { indexed: count, removed, kept }
  }

  /** The passages closest to `query`, for a site — its own and every site's. */
  async search(query: string, siteId: string, limit = 5): Promise<Found[]> {
    const [vector] = await this.embed([query])
    if (!vector) return []
    const distance = cosineDistance(kbChunks.embedding, vector)
    const rows = await this.db
      .select({
        source: kbChunks.source,
        sourceId: kbChunks.sourceId,
        title: kbChunks.title,
        text: kbChunks.text,
        distance,
      })
      .from(kbChunks)
      .where(sql`(cardinality(${kbChunks.siteIds}) = 0 or ${siteId} = any(${kbChunks.siteIds}))`)
      .orderBy(distance)
      .limit(limit)
    return rows.map((row) => ({
      source: row.source,
      sourceId: row.sourceId,
      title: row.title,
      text: row.text,
      similarity: 1 - Number(row.distance),
    }))
  }

  /** Whether anything is indexed at all — without it, the AI has nothing to answer from. */
  async size(): Promise<number> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(kbChunks)
    return row?.n ?? 0
  }
}
