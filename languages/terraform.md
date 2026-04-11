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
