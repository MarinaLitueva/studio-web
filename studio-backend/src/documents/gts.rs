//! GTS type registration for studio-documents.
//!
//! Document *types* are registered in the platform types-registry so other
//! gears and the UI can discover them: the two base types plus one id per
//! built-in catalogue type. Free-form (`type: object`) schemas, the same shape
//! the studio artifact types use, so registration never trips the
//! closed-envelope narrowing check.

use serde_json::{json, Value};

use super::model::{builtin_types, type_gts_id};

pub const DOCUMENT_TYPE: &str = "gts.cf.studio.document_type.v1~";
pub const DOCUMENT: &str = "gts.cf.studio.document.v1~";

/// Schemas registered at gear init.
pub fn type_schemas() -> Vec<Value> {
    let mut entries: Vec<(String, String, String)> = vec![
        (
            DOCUMENT_TYPE.to_string(),
            "DocumentType".to_string(),
            "A document type: a template, section checklist and conformance rules.".to_string(),
        ),
        (
            DOCUMENT.to_string(),
            "Document".to_string(),
            "A document instance created from a document type.".to_string(),
        ),
    ];
    for t in builtin_types() {
        entries.push((
            type_gts_id(&t.key),
            t.name.clone(),
            format!("Built-in document type: {}", t.description),
        ));
    }
    entries
        .into_iter()
        .map(|(id, title, description)| {
            json!({
                "$id": format!("gts://{id}"),
                "$schema": "http://json-schema.org/draft-07/schema#",
                "title": title,
                "description": description,
                "type": "object",
            })
        })
        .collect()
}
