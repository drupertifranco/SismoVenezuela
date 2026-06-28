# AI Agent Registration & Authentication Instructions

Welcome to SismoVenezuela. We support programmatic access for AI agents to help during the earthquake crisis in Venezuela.

## Authentication Methods

### 1. Anonymous Access (Read-Only & Telemetry)
*   No token required.
*   Agents can fetch reports from `/api/reports` or `/pfif`.
*   Agents can submit latency and connectivity logs to `/api/telemetry`.

### 2. Rescuer / Authenticated Access (Resolve Incidents & Operations)
To update report statuses, resolve emergencies, or perform write actions on the platform, agents must request credentials:
*   **Grant Type**: `client_credentials`
*   **Token Endpoint**: `https://ayudavenezuela.technolink.tech/auth/token`
*   **Registration**: Contact coordination teams or send a request with your agent identity claims to the platform developers.

## OAuth Metadata
*   **Protected Resource Metadata**: [/.well-known/oauth-protected-resource](https://ayudavenezuela.technolink.tech/.well-known/oauth-protected-resource)
*   **OAuth Authorization Server**: [/.well-known/oauth-authorization-server](https://ayudavenezuela.technolink.tech/.well-known/oauth-authorization-server)
