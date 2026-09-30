-- pgvector, for the embeddings of kb_chunk (D1). The schema itself is created by the next
-- migration; the extension goes first because a column of type vector needs it.
CREATE EXTENSION IF NOT EXISTS vector;
