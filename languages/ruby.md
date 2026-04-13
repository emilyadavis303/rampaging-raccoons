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

## RSpec — betterspecs.org

When reviewing spec files, check for adherence to [betterspecs.org](https://www.betterspecs.org) guidelines. These patterns make specs more readable for humans *and* more parseable for agents — clear structure means faster comprehension and fewer misinterpretations.

- **`describe` for methods, `context` for conditions** — `describe '#method_name'` (instance) / `describe '.method_name'` (class). Nested `context` blocks for branching behavior (`context 'when user is admin'`). Flag specs that mix these or use bare `it` blocks at the top level.
- **One expectation per example** — each `it` block should test one behavior. Multiple expectations in a single example make failures ambiguous and harder for agents to pinpoint.
- **Meaningful `it` descriptions** — descriptions should state the expected behavior, not restate the code. `it 'returns the user's full name'` not `it 'works'` or `it 'does the thing'`.
- **`let` over instance variables** — never use `@instance_vars` in specs. Use `let` (lazy) by default, `let!` only when the record must exist before the example runs.
- **Named subjects** — `subject(:user)` not anonymous `subject`. Makes specs self-documenting.
- **`build` over `create`** — don't hit the database when persistence isn't needed. Prefer `build` or `build_stubbed` for read-only tests.
- **`instance_double` over `double`** — validates the interface against the real class. Catches method signature drift.
- **FactoryBot traits for variations** — `create(:user, :admin)` not `create(:user, role: 'admin')`. Traits centralize test data definitions.
- **Shared examples for reusable behavior** — `it_behaves_like "archivable"` establishes greppable patterns across the codebase.
- **`before` blocks for setup only** — stubs, config, and side effects. Not test data — that's what `let` is for.
- **Test behavior, not implementation** — specs should describe *what* the code does, not *how*. Flag specs that assert on internal method calls or private state unless there's a clear reason.
