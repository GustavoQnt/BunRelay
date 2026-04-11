# Security Policy

## Supported Scope

BunRelay is an open source template, so security reports are most useful when they affect the reusable baseline, for example:

- Authentication and session handling
- Token rotation and replay detection
- Authorization and room governance
- Input validation and payload handling
- WebSocket abuse controls
- Logging or observability leaks
- Default configuration risks

## Reporting a Vulnerability

Please do not open a public GitHub issue for sensitive security reports.

Instead, contact the maintainer privately with:

- A clear description of the issue
- Steps to reproduce
- Impact assessment
- Suggested mitigation if you have one

If a private contact channel is not yet published in the repository settings, open a minimal issue asking for a private reporting path without disclosing details.

## Response Expectations

Best effort process:

1. Acknowledge receipt.
2. Validate and reproduce the issue.
3. Prepare a fix or mitigation.
4. Publish the fix and disclose it responsibly when appropriate.

## Security Notes for Users

- Change `JWT_SECRET` outside local development.
- Treat seeded credentials as local-demo only.
- Use TLS and secure secret management in production deployments.
- Review environment defaults before exposing BunRelay publicly.
