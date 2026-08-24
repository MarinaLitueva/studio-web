package org.constructorfabric.studio.keycloak;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class GitHubMembershipResponseTest {
    @Test
    void acceptsOnlyActiveMembership() {
        assertTrue(GitHubMembershipResponse.isActive(200, "{\"state\":\"active\",\"role\":\"member\"}"));
    }

    @Test
    void rejectsPendingMembership() {
        assertFalse(GitHubMembershipResponse.isActive(200, "{\"state\":\"pending\"}"));
    }

    @Test
    void rejectsMissingMembershipAndApiErrors() {
        assertFalse(GitHubMembershipResponse.isActive(404, "{}"));
        assertFalse(GitHubMembershipResponse.isActive(403, "{\"message\":\"Forbidden\"}"));
        assertFalse(GitHubMembershipResponse.isActive(200, null));
        assertFalse(GitHubMembershipResponse.isActive(200, "not-json"));
        assertFalse(GitHubMembershipResponse.isActive(200, "{\"nested\":{\"state\":\"active\"}}"));
    }
}
