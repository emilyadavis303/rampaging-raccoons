# Ruby / Rails

Patterns to watch for in Ruby and Rails code:

- **nil paths:** Methods chaining on potentially nil values without safe navigation or guard clauses
- **N+1 queries:** Associations loaded inside loops without `includes`/`preload`/`eager_load`
- **Mass assignment:** Controllers accepting params without strong parameters
- **Unscoped finds:** `Model.find(id)` without tenant/user scoping where authorization matters
- **Callback complexity:** `before_save`/`after_commit` callbacks doing too much — prefer explicit service objects
- **Fat controllers:** Business logic in controller actions instead of models/services
- **Migration safety:** `add_column`/`remove_column` without `if_exists`/`if_not_exists` guards, `def change` where rollback is dangerous, missing concurrent index creation on large tables
- **Boolean returns from bang methods:** Methods ending in `!` that return true/false instead of raising
- **Scope vs class method:** Prefer scopes for reusable queries, class methods for complex logic
- **Constants over magic strings:** `User::ROLES[:admin]` not `"admin"`
