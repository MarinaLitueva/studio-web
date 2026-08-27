//! Bridge service: resolves a session and performs studio→Theia control calls.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde::de::DeserializeOwned;
use toolkit_canonical_errors::CanonicalError;
use toolkit_security::SecurityContext;

use crate::studio_theia::config::StudioTheiaConfig;
use crate::studio_theia::discovery::{ControlTokenResolver, TheiaEndpointResolver};
use crate::studio_theia::sdk::{SessionTarget, TheiaControlError};
use crate::studio_theia::sink::TheiaEventSink;

/// Owns the HTTP client + endpoint resolver and performs the raw control calls.
pub struct TheiaService {
    config: StudioTheiaConfig,
    http: reqwest::Client,
    resolver: Arc<dyn TheiaEndpointResolver>,
    token_resolver: Arc<dyn ControlTokenResolver>,
    sink: Arc<dyn TheiaEventSink>,
}

impl TheiaService {
    pub fn new(
        config: StudioTheiaConfig,
        resolver: Arc<dyn TheiaEndpointResolver>,
        token_resolver: Arc<dyn ControlTokenResolver>,
        sink: Arc<dyn TheiaEventSink>,
    ) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.request_timeout_secs))
            .build()?;
        Ok(Self {
            config,
            http,
            resolver,
            token_resolver,
            sink,
        })
    }

    // Retained for the disabled-gear 503 path and future ingress policy.
    #[allow(dead_code)]
    pub fn config(&self) -> &StudioTheiaConfig {
        &self.config
    }

    pub fn sink(&self) -> &Arc<dyn TheiaEventSink> {
        &self.sink
    }

    pub fn token_resolver(&self) -> &Arc<dyn ControlTokenResolver> {
        &self.token_resolver
    }

    /// POST `{base}/internal/theia/v1/{method}` under the resolved session
    /// endpoint, with the S2S token header, and decode the JSON response.
    pub async fn call<Req, Resp>(
        &self,
        ctx: &SecurityContext,
        target: &SessionTarget,
        method: &str,
        body: &Req,
    ) -> Result<Resp, TheiaControlError>
    where
        Req: Serialize,
        Resp: DeserializeOwned,
    {
        let endpoint = self.resolver.resolve(ctx, target).await?;
        let url = format!("{}/internal/theia/v1/{method}", endpoint.base_url);
        let response = self
            .http
            .post(&url)
            .header("X-CFS-Theia-Token", &endpoint.token)
            .json(body)
            .send()
            .await
            .map_err(|e| upstream_error(method, e))?;
        if !response.status().is_success() {
            let status = response.status();
            return Err(CanonicalError::service_unavailable()
                .with_detail(format!("Theia control '{method}' returned HTTP {status}"))
                .create());
        }
        response
            .json::<Resp>()
            .await
            .map_err(|e| upstream_error(method, e))
    }
}

fn upstream_error(method: &str, e: reqwest::Error) -> TheiaControlError {
    CanonicalError::service_unavailable()
        .with_detail(format!("Theia control '{method}' failed: {e}"))
        .create()
}
