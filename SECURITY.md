# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report privately through GitHub (**Security > Report a vulnerability** on this
repository) or by e-mail to the CRM owner at Amuwa Corporation. Include what you found, how to reproduce it in a test
environment, and the impact you expect. Do not access, change or download real customer data to prove an issue.

We acknowledge reports within 3 working days and keep the reporter informed until the fix is deployed.

## Where the security record lives

* [docs/security/FINDINGS.md](docs/security/FINDINGS.md): findings, status, evidence, tests and remaining risk.
* [docs/security/THREAT_MODEL.md](docs/security/THREAT_MODEL.md): architecture, trust boundaries, inventory, change checklist.
* [docs/security/DEPLOYMENT_CHECKLIST.md](docs/security/DEPLOYMENT_CHECKLIST.md): rollout steps and standing owner checks.
* [docs/SECURITY.md](docs/SECURITY.md): earlier hardening, settings to switch on, audit logging.

## Automated checks

`npm run test:security` (database authorization and isolation suites), `npm run test:db`, `npm run test:api`,
`npm run security:semgrep`, and in CI: production dependency audit, gitleaks over the full history, bundle secret check.
A weekly scheduled workflow (`.github/workflows/security.yml`) repeats the dependency, secret and database checks.
Passing checks do not make the application secure; they stop known mistakes from returning.
