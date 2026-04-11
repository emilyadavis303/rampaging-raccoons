# CI/CD

Patterns to watch for in CI/CD configuration (CircleCI, GitHub Actions, Docker, Kubernetes):

- **Missing region/account context:** CI jobs running `aws` commands without `AWS_DEFAULT_REGION` or `AWS_ACCOUNT_ID`
- **Hardcoded secrets:** Credentials, tokens, or API keys inline instead of using secret management
- **Missing environment variables:** Jobs that reference env vars not defined in the config or org settings
- **Docker layer ordering:** Frequently-changing layers (code copy) should come after stable layers (dependency install)
- **Kubernetes resource limits:** Pods without CPU/memory requests and limits
- **Config drift:** CircleCI orb versions or GitHub Action versions pinned to old majors
- **Missing caching:** Build steps that could use caching (dependency install, compilation) but don't
- **Overly broad triggers:** Workflows that run on all branches/paths when they should be scoped
