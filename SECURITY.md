# Security Policy

## Reporting a vulnerability
Do not open public issues for security vulnerabilities.

Use GitHub's private vulnerability reporting flow:
1. Open the repository `Security` tab.
2. Select `Report a vulnerability`.
3. Include reproduction steps, impact, and suggested mitigation if available.

## Response expectations
- Initial triage response target: within 72 hours.
- Status updates: at least weekly until resolution or mitigation is published.

## Credential handling and rotation
- If a credential exposure is suspected, rotate impacted credentials immediately.
- Remove leaked secrets from current code and configuration.
- Re-run full-history secret scanning before new releases.
- If leaks are in git history, rewrite history or publish a clean snapshot repository before public release.

## Supported versions
Security fixes are applied to the latest release line.
