//! Boundary mapping from `DomainError` to the canonical error envelope.
//!
//! This is the single authoritative mapping: both the REST adapter and the
//! in-process client surface the same category for the same failure, as the
//! Error Model section of `docs/DESIGN.md` requires.

use toolkit::api::canonical_prelude::*;

use crate::graph_storage::domain::error::DomainError;

#[resource_error(gts_id!("cf.core.kg.node.v1~"))]
struct GraphResourceError;

impl From<DomainError> for CanonicalError {
    fn from(err: DomainError) -> Self {
        match err {
            DomainError::Storage(_) => GraphResourceError::unknown(err.to_string()).create(),
            DomainError::BatchTooLarge { .. } => GraphResourceError::out_of_range(err.to_string())
                .with_field_violation("batch", err.to_string(), "LIMIT_EXCEEDED")
                .create(),
            DomainError::UnknownType(ref t) => GraphResourceError::invalid_argument()
                .with_field_violation("type_id", err.to_string(), "TYPE_NOT_REGISTERED")
                .with_resource(t.clone())
                .create(),
            DomainError::UnknownEndpoint(ref k) => GraphResourceError::invalid_argument()
                .with_field_violation("node_key", err.to_string(), "ENDPOINT_NOT_DEFINED")
                .with_resource(k.clone())
                .create(),
            DomainError::NotInitialised => GraphResourceError::failed_precondition()
                .with_precondition_violation(
                    "graph-storage",
                    err.to_string(),
                    "SERVICE_NOT_INITIALISED",
                )
                .create(),
        }
    }
}
