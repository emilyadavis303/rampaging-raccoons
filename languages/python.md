# Python

Patterns to watch for in Python code:

- **Bare except:** `except:` or `except Exception` swallows everything including KeyboardInterrupt — catch specific exceptions
- **Mutable defaults:** `def foo(items=[])` shares state across calls — use `None` and initialize inside
- **Missing ClientError handling:** AWS SDK calls without `botocore.exceptions.ClientError` handling
- **Import ordering:** stdlib → third-party → local, with blank lines between groups
- **Type hints at boundaries:** Public functions and module interfaces should have type annotations
- **Unvalidated env vars:** `os.environ["KEY"]` without validation — use `os.environ.get()` with fallbacks at system boundaries
- **Mutable module-level state:** Global mutable variables that create hidden coupling
- **Overly clever comprehensions:** Nested comprehensions or complex lambdas that would be clearer as loops
- **`*args`/`**kwargs` hiding bugs:** Catch-all signatures that mask missing or extra arguments
