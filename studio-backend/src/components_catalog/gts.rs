//! GTS identifiers, type schemas and node/edge model for the gears catalog.
//!
//! The catalog mirrors the artifact-ingest graph model but for a different
//! domain: published crates ("gears") and their versions, pulled from
//! crates.io. Instance ids are deterministic (uuid5 of a stable key), so a
//! re-sync upserts the same nodes rather than duplicating them.

use serde_json::{Value, json};
use uuid::Uuid;

/// Fixed namespace for uuid5 instance ids (studio gears catalog). Distinct from
/// the artifact graph's namespace so the two never collide on a key.
const INSTANCE_NS: Uuid = Uuid::from_u128(0xcf57_0000_0000_4000_8000_0000_0000_0002);

/// A published crate — one of "our gears" on crates.io.
pub const GEAR_TYPE: &str = "gts.cf.studio.catalog.gear.v1~";
/// One published version of a gear crate.
pub const CRATE_VERSION_TYPE: &str = "gts.cf.studio.catalog.crate_version.v1~";
/// Studio-managed, editable catalog metadata for one gear. It is stored
/// independently from crates.io data, so a sync cannot erase it.
pub const GEAR_PROFILE_TYPE: &str = "gts.cf.studio.catalog.gear_profile.v1~";

/// Every catalog node type, for registering and enumerating.
pub const ALL_NODE_TYPES: [&str; 3] = [GEAR_TYPE, CRATE_VERSION_TYPE, GEAR_PROFILE_TYPE];

/// gear → crate_version — a version published under this crate.
pub const REL_HAS_VERSION: &str = "gts.cf.studio.catalog.rel.has_version.v1~";

/// Every catalog relation type, for registering in the graph.
pub const ALL_EDGE_TYPES: [&str; 1] = [REL_HAS_VERSION];

/// A GTS node to persist: type id, deterministic instance id, and payload.
#[derive(Debug, Clone)]
pub struct GtsNode {
    pub type_id: &'static str,
    pub instance_id: String,
    pub value: Value,
}

/// A GTS edge to persist: type id and endpoint instance ids.
#[derive(Debug, Clone)]
pub struct GtsEdge {
    pub type_id: &'static str,
    pub from: String,
    pub to: String,
}

/// The type id the graph-storage gear stores this type under. The gear keeps
/// its own type table and its ids omit the `gts.` scheme token, so we strip it
/// (same convention as artifact-ingest).
pub fn graph_type_id(our_type: &str) -> String {
    our_type
        .strip_prefix("gts.")
        .unwrap_or(our_type)
        .to_string()
}

/// Reverse of [`graph_type_id`]: map a graph-storage type id back to our
/// `&'static` constant so a node read back keeps its typed identity.
pub fn our_type_from_graph(graph_type: &str) -> Option<&'static str> {
    ALL_NODE_TYPES
        .into_iter()
        .find(|t| graph_type_id(t) == graph_type)
}

/// GTS type schemas registered at gear init (free-form `type: object`, same
/// shape the studio types use, so registration never trips the narrowing check).
pub fn type_schemas() -> Vec<Value> {
    [
        (
            GEAR_TYPE,
            "Gear",
            "A published crate — one of our gears on crates.io.",
        ),
        (
            CRATE_VERSION_TYPE,
            "CrateVersion",
            "One published version of a gear crate.",
        ),
        (
            GEAR_PROFILE_TYPE,
            "GearProfile",
            "Editable Studio metadata for one gear, kept separately from crates.io sync data.",
        ),
    ]
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

/// Deterministic instance id from a stable composite key.
fn anon_id(parts: &[&str]) -> String {
    Uuid::new_v5(&INSTANCE_NS, parts.join("|").as_bytes()).to_string()
}

/// The instance id of a gear node (keyed on crate name).
pub fn gear_instance_id(name: &str) -> String {
    anon_id(&["gear", name])
}

/// The instance id of a version node (keyed on crate name + version number).
pub fn version_instance_id(name: &str, num: &str) -> String {
    anon_id(&["crate_version", name, num])
}

/// The instance id of a custom profile node (keyed on the gear crate name).
pub fn gear_profile_instance_id(name: &str) -> String {
    anon_id(&["gear_profile", name])
}

/// A gear node. `value` is the curated crate payload built by the service.
pub fn gear_node(name: &str, value: Value) -> GtsNode {
    GtsNode {
        type_id: GEAR_TYPE,
        instance_id: gear_instance_id(name),
        value,
    }
}

/// A crate-version node. `value` is the curated version payload.
pub fn crate_version_node(name: &str, num: &str, value: Value) -> GtsNode {
    GtsNode {
        type_id: CRATE_VERSION_TYPE,
        instance_id: version_instance_id(name, num),
        value,
    }
}

/// An editable profile for a gear. The caller owns the profile payload; the
/// service injects its stable `gear_name` identity before persisting it.
pub fn gear_profile_node(name: &str, value: Value) -> GtsNode {
    GtsNode {
        type_id: GEAR_PROFILE_TYPE,
        instance_id: gear_profile_instance_id(name),
        value,
    }
}

/// gear → crate_version.
pub fn has_version_edge(gear_id: &str, version_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_HAS_VERSION,
        from: gear_id.to_string(),
        to: version_id.to_string(),
    }
}
