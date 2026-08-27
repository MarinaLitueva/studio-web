//! The embedding seam.
//!
//! graph-storage stores and searches vectors (pgvector + HNSW cosine) but never
//! computes them — the producer must. This trait is where an embedder plugs in.
//! The default [`NoopEmbedder`] computes nothing (`dimensions() == 0`), so the
//! pipe is wired end to end while a real model (e.g. a 384-dim MiniLM to match
//! the graph's `VECTOR(384)` column) drops in behind the trait later.
//!
//! [`OpenAiEmbedder`] is the real implementation: it calls an OpenAI-compatible
//! `/embeddings` endpoint (configured via env) and produces vectors of the
//! graph's dimension. When it is not configured the pipeline uses `NoopEmbedder`
//! and search stays lexical — turning on semantic search is pure configuration.

use std::time::Duration;

use anyhow::anyhow;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

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

/// Default embedding dimension — matches graph-storage's `VECTOR(384)` column.
const DEFAULT_DIMENSIONS: usize = 384;
/// Max inputs per `/embeddings` request.
const EMBED_BATCH: usize = 64;

/// A real embedder that calls an OpenAI-compatible `/embeddings` endpoint.
///
/// Configured entirely from the environment so semantic search is a deploy-time
/// switch, not a code change:
///   - `STUDIO_EMBED_BASE_URL`  — API root, e.g. `https://api.openai.com/v1`
///   - `STUDIO_EMBED_MODEL`     — e.g. `text-embedding-3-small`
///   - `STUDIO_EMBED_API_KEY`   — bearer token
///   - `STUDIO_EMBED_DIMENSIONS`— optional, defaults to 384 (the graph column)
///
/// Produced vectors MUST equal the graph's dimension or the store refuses them;
/// a size mismatch (a model that ignores the `dimensions` request) is dropped to
/// `None` rather than failing ingest.
pub struct OpenAiEmbedder {
    http: reqwest::Client,
    base_url: String,
    model: String,
    api_key: String,
    dimensions: usize,
}

#[derive(Serialize)]
struct EmbeddingsRequest<'a> {
    model: &'a str,
    input: &'a [String],
    /// Only sent when > 0; models that support it return exactly this many dims.
    #[serde(skip_serializing_if = "Option::is_none")]
    dimensions: Option<usize>,
}

#[derive(Deserialize)]
struct EmbeddingsResponse {
    #[serde(default)]
    data: Vec<EmbeddingDatum>,
}

#[derive(Deserialize)]
struct EmbeddingDatum {
    #[serde(default)]
    index: usize,
    #[serde(default)]
    embedding: Vec<f32>,
}

impl OpenAiEmbedder {
    /// Build from the environment, or `None` when the endpoint is not fully
    /// configured (base URL + model + API key all required).
    pub fn from_env() -> Option<Self> {
        let var = |k: &str| {
            std::env::var(k)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let base_url = var("STUDIO_EMBED_BASE_URL")?
            .trim_end_matches('/')
            .to_string();
        let model = var("STUDIO_EMBED_MODEL")?;
        let api_key = var("STUDIO_EMBED_API_KEY")?;
        let dimensions = var("STUDIO_EMBED_DIMENSIONS")
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|d| *d > 0)
            .unwrap_or(DEFAULT_DIMENSIONS);
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .ok()?;
        Some(Self {
            http,
            base_url,
            model,
            api_key,
            dimensions,
        })
    }

    /// Embed one batch (≤ [`EMBED_BATCH`]); result aligns to `texts` by the
    /// response `index`. Vectors of the wrong dimension are dropped to `None`.
    async fn embed_batch(&self, texts: &[String]) -> anyhow::Result<Vec<Option<Vec<f32>>>> {
        let req = EmbeddingsRequest {
            model: &self.model,
            input: texts,
            dimensions: Some(self.dimensions),
        };
        let res = self
            .http
            .post(format!("{}/embeddings", self.base_url))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&req)
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(anyhow!(
                "embeddings endpoint returned HTTP {}",
                res.status()
            ));
        }
        let body: EmbeddingsResponse = res.json().await?;
        let mut out: Vec<Option<Vec<f32>>> = vec![None; texts.len()];
        for d in body.data {
            if d.index >= out.len() {
                continue;
            }
            out[d.index] = if d.embedding.len() == self.dimensions {
                Some(d.embedding)
            } else {
                tracing::warn!(
                    got = d.embedding.len(),
                    want = self.dimensions,
                    "studio-artifact-ingest: embedding dimension mismatch — dropping vector"
                );
                None
            };
        }
        Ok(out)
    }
}

#[async_trait]
impl Embedder for OpenAiEmbedder {
    fn dimensions(&self) -> usize {
        self.dimensions
    }

    async fn embed(&self, texts: &[String]) -> anyhow::Result<Vec<Option<Vec<f32>>>> {
        let mut out: Vec<Option<Vec<f32>>> = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(EMBED_BATCH) {
            match self.embed_batch(chunk).await {
                Ok(vecs) => out.extend(vecs),
                Err(e) => {
                    // A failed batch stores that chunk without vectors rather than
                    // failing the whole sync — search still works lexically for it.
                    tracing::warn!(error = %e, "studio-artifact-ingest: embeddings batch failed — chunk stored without vectors");
                    out.extend(std::iter::repeat_with(|| None).take(chunk.len()));
                }
            }
        }
        Ok(out)
    }
}
