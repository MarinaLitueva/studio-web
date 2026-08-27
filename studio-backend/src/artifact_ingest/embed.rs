//! The embedding seam.
//!
//! graph-storage stores and searches vectors (pgvector + HNSW cosine) but never
//! computes them — the producer must. This trait is where an embedder plugs in.
//! The default [`NoopEmbedder`] computes nothing (`dimensions() == 0`), so the
//! pipe is wired end to end while a real model (e.g. a 384-dim MiniLM to match
//! the graph's `VECTOR(384)` column) drops in behind the trait later.

use async_trait::async_trait;

#[async_trait]
pub trait Embedder: Send + Sync {
    /// Embedding dimension, or `0` when this embedder computes nothing. Callers
    /// use `0` to skip the embedding step entirely.
    fn dimensions(&self) -> usize;

    /// Embed each input text. Returns one slot per input, `None` where no vector
    /// was produced. A produced vector's length must equal [`Self::dimensions`].
    async fn embed(&self, texts: &[String]) -> anyhow::Result<Vec<Option<Vec<f32>>>>;
}

/// Embeds nothing — the default until a real model is wired. `dimensions() == 0`
/// lets the ingest and search paths short-circuit the embedding step.
#[derive(Default)]
pub struct NoopEmbedder;

#[async_trait]
impl Embedder for NoopEmbedder {
    fn dimensions(&self) -> usize {
        0
    }

    async fn embed(&self, texts: &[String]) -> anyhow::Result<Vec<Option<Vec<f32>>>> {
        Ok(vec![None; texts.len()])
    }
}
