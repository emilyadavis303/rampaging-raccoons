# Ruby / Rails

Patterns to watch for in Ruby and Rails code:

- **nil paths:** Methods chaining on potentially nil values without safe navigation or guard clauses
- **N+1 queries:** Associations loaded inside loops without `includes`/`preload`/`eager_load`
- **Mass assignment:** Controllers accepting params without strong parameters
- **Unscoped finds:** `Model.find(id)` without tenant/user scoping where authorization matters
- **Callback complexity:** `before_save`/`after_commit` callbacks doing too much — prefer explicit service objects
- **Fat controllers:** Business logic in controller actions instead of models/services
- **Migration safety:** See the detailed Database Lens below for the full checklist

## Database Lens

Apply this lens whenever the PR touches database-related files: `db/migrate/*`,
`db/listings_migrate/*`, `db/structure.sql`, or raw `.sql` files. Every item
below has been flagged on a real PR.

### Statement timeout & DDL transaction safety
- **`SET statement_timeout` leaking:** When using `disable_ddl_transaction!`, `SET statement_timeout` applies to the session, not the transaction. Use `SET LOCAL statement_timeout` inside a transaction, or reset explicitly after each statement. Unbounded `SET statement_timeout TO 0` is discouraged — use a bounded timeout with precedent from existing migrations (check for examples like `CreateHomeCheckIns`).
- **Multiple DDL statements outside a transaction:** `disable_ddl_transaction!` means each statement runs independently. If the migration fails partway through, you're left in a partial state with no rollback. Flag when a migration has `disable_ddl_transaction!` and more than one DDL statement.
- **Concurrent index + timeout:** If `algorithm: :concurrently` exceeds the statement timeout, the index is left in an INVALID state. The migration won't error — you just silently get a broken index.

### Idempotency & rollback
- **Missing guards:** `add_column`, `add_index`, `rename_column`, `remove_column` should use `if_exists:`/`if_not_exists:` or `column_exists?`/`index_exists?` checks (but don't use both — that's redundant).
- **`def change` where rollback is dangerous:** If the `down` path could fail (e.g., re-adding a unique constraint after data has changed, removing a column that was backfilled), use explicit `up`/`down` with `raise ActiveRecord::IrreversibleMigration` in `down` where appropriate.
- **`remove_foreign_key` without `to_table:`** makes the migration irreversible since Rails can't infer the target table for rollback.

### NULL semantics in unique indexes
- **Postgres unique indexes allow multiple NULLs.** A unique index on `(a, b)` where `b` is nullable won't actually deduplicate when `b IS NULL`. Suggest: partial index (`WHERE col IS NOT NULL`), expression index with `COALESCE`, or adding a NOT NULL constraint.

### Foreign key lifecycle
- **Two-step FK pattern:** FKs on existing tables should be added with `validate: false` in one migration, then validated in a separate migration. Flag if the validation step is missing.
- **`ON DELETE` mismatch:** If the Rails model has `dependent: :destroy` or `dependent: :delete_all`, the FK should have a matching `on_delete:` option. Flag mismatches.
- **FKs on large/growing tables:** Adding or validating a FK on a large table acquires a lock. The team has explicitly removed FKs for this reason (lockbox `confirmation_codes` → `users`). Flag and ask whether the table size warrants caution.

### Index creation
- **Indexes must be in separate migrations** from `create_table` when using `algorithm: :concurrently`, since `disable_ddl_transaction!` is incompatible with `create_table`.
- **Removing a FK removes the index.** If a FK is dropped, check whether an explicit `add_index` is needed to preserve query performance.
- **Index naming conventions:** Check existing indexes in `structure.sql` for the naming pattern. Mikasa uses `{table}_{columns}` for listings tables, not `idx_` prefix.

### Data manipulation & backfills
- **No data manipulation in migrations.** Backfills inside migrations hit timeouts on large tables and leave partial state on failure. Team convention: release the schema change, then run a separate rake task or script to backfill.
- **New required columns need a backfill plan.** Adding a column with `null: false` or a NOT NULL constraint validation without a plan for existing records will break seeds and existing data.

### structure.sql integrity
- **Dirty dumps:** `structure.sql` should only contain tables and migrations that exist in the codebase. Flag if the diff includes tables, `schema_migrations` entries, or extensions that don't correspond to migration files in the PR or repo.
- **Missing FK/index in dump:** If a migration adds a FK or index, verify it appears in the `structure.sql` changes.

### Column & table conventions
- **Migration version must match current Rails version.** `ActiveRecord::Migration[8.1]` for Rails 8.1 apps — not `[6.1]` or `[7.1]`. AI-generated migrations frequently get this wrong.
- **Migration class name should match the table.** `CreateSyncEvents` for a `sync_events` table, not `CreateSyncs`.
- **JSONB default type:** Ensure the migration default (`[]` vs `{}`) matches what application code expects. Mismatches cause runtime errors.
- **UUID configuration:** In repos using UUIDv7 (carrier-pigeon), explicit `id: :uuid` in `create_table` bypasses the UUIDv7 initializer and falls back to UUIDv4. Omit `id: :uuid` to use the app's configured default.
- **Boolean vs string for simple flags:** If a column is a two-state flag, prefer a boolean over a string.

### Multi-step deploy safety
- **NOT NULL via check constraint:** Safe pattern is: (1) add check constraint unvalidated, (2) validate constraint, (3) set NOT NULL. Check that `down` reverses in the correct order (allow NULL first, then drop constraint).
- **Don't squash unmerged migrations.** Each migration should be its own file — don't fold a new migration into an earlier unmerged one. Avoids "the unholy intersection of DB rollbacks, schema version, and Git history."

### Raw SQL in migrations
- **Extra scrutiny on PG functions, triggers, and raw SQL.** These get less tooling support and historically have more bugs: wrong column references, division-by-zero as param guards, date format mismatches between SQL and Ruby, filter value omissions. Verify every column name, function parameter, and date format against the Ruby code that calls it.
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
