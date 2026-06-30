# Terraform

Patterns to watch for in Terraform code:

- **IAM wildcards:** `Action: ["*"]` or `Resource: ["*"]` — policies should be least-privilege
- **Missing encryption:** S3 buckets, RDS instances, EBS volumes, SQS queues without encryption at rest
- **Public access:** Security groups with `0.0.0.0/0` ingress, S3 buckets with public ACLs
- **Lifecycle rules:** Resources that would destroy data if replaced — use `prevent_destroy` or `create_before_destroy`
- **Version pins:** Provider and module versions pinned too loosely (`>=`) or too tightly (exact patch). Prefer `~>`
- **Missing descriptions:** Variables and outputs without `description` fields
- **Magic values:** Hardcoded numbers or strings that should be named locals or variables
- **Module extraction timing:** Don't extract a module until there are 2+ consumers
- **State considerations:** Resources painful to move between state files later (RDS, S3, IAM roles)
- **Tagging:** Resources should follow the repo's existing tagging conventions

## False-positive patterns — do NOT flag these

- **`count = 1` on existing resources:** When a resource previously used `count = var.x ? 1 : 0` and the PR changes it to `count = 1`, this is intentional — removing `count` entirely changes the state address from `resource.name[0]` to `resource.name`, triggering destroy/recreate on every instance. Only flag `count = 1` as vestigial if the resource is brand new in this PR.
- **`for_each` ↔ `count` transitions:** Always have state address implications. Don't suggest switching between them without acknowledging the migration cost.
- **ECR lifecycle glob patterns:** Patterns like `*-20*` in `tag_pattern_list` are standard for matching date-tagged images (`*-2025-01-15`). Don't flag as "fragile" or "matches too broadly" unless you can name a concrete, realistic false match in that repo's tagging scheme.
