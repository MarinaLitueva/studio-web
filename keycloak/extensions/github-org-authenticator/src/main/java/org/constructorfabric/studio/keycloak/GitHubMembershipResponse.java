package org.constructorfabric.studio.keycloak;

import java.io.IOException;
import java.util.Map;

import org.keycloak.util.JsonSerialization;

final class GitHubMembershipResponse {
    private GitHubMembershipResponse() {
    }

    static boolean isActive(int statusCode, String responseBody) {
        if (statusCode != 200 || responseBody == null) {
            return false;
        }
        try {
            Map<?, ?> membership = JsonSerialization.readValue(responseBody, Map.class);
            return "active".equals(membership.get("state"));
        } catch (IOException | RuntimeException ignored) {
            return false;
        }
    }
}
