//! studio-session — Studio's first own gear.
//!
//! Launches, tracks and reaps per-workspace Theia IDE sessions (theia/ image).
//! The runtime lives behind a [`driver::SessionDriver`]: [`docker::DockerDriver`]
//! runs containers on the local daemon (the MVP), the Kubernetes driver runs
//! Pods behind the backend's proxy — same REST contract either way. See
//! docs/adr/0003-theia-sessions.md for the architecture and the k8s path.

pub mod config;
pub mod docker;
pub mod driver;
pub mod gear;
pub mod k8s;
pub mod proxy;
pub mod rest;
pub mod sdk;
pub mod service;
