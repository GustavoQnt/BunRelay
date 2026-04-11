# Extending BunRelay

## Typical extension points

Common ways to extend BunRelay include:

- adding a new REST endpoint
- adding a new WebSocket event
- adding a new table or migration
- adding a new service for isolated business logic
- expanding the demo UI to exercise a new backend capability

## Suggested workflow

1. Define the contract first in shared validation or protocol code.
2. Add tests for the expected behavior.
3. Implement the server route or event handler.
4. Update docs and demo flows if the change is user-visible.

## Keep the template focused

When adding features, ask:

- Does this help BunRelay teach or demonstrate a reusable pattern?
- Is this general enough for a template?
- Does it keep onboarding simple?

If the answer is no, the feature may belong in a downstream fork instead of the base template.
