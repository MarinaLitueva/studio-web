//! Domain error type.
//!
//! The mapping to `CanonicalError` lives at the API boundary
//! (`api::rest::error`), per the Error Model section of `docs/DESIGN.md`.

use thiserror::Error;

/// Errors produced by the domain layer.
#[derive(Debug, Error)]
pub enum DomainError {
    /// The gear is not fully initialised yet.
    #[error("graph-storage service is not initialised")]
    NotInitialised,
    /// A referenced GTS type is not registered for this tenant.
    #[error("type is not registered: {0}")]
    UnknownType(String),
    /// A referenced node key is absent from both the batch and the store.
    #[error("edge endpoint is not defined: {0}")]
    UnknownEndpoint(String),
    /// A batch exceeded its configured admission limit.
    #[error("{kind} batch of {requested} exceeds the limit of {limit}")]
    BatchTooLarge {
        /// Which family overflowed.
        kind: &'static str,
        /// Configured hard bound.
        limit: u32,
        /// Size the caller requested.
        requested: usize,
    },
    /// A storage operation failed.
    #[error("storage failure: {0}")]
    Storage(String),
}
