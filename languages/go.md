# Go

Patterns to watch for in Go code:

- **Unchecked errors:** Every error return must be checked — `_ = someFunc()` is a red flag
- **Goroutine leaks:** Goroutines without context cancellation or shutdown signals
- **Defer in loops:** `defer` inside a loop won't execute until the function returns, not the loop iteration
- **Nil pointer dereference:** Methods called on potentially nil receivers, especially after type assertions
- **Interface bloat:** Interfaces with 5+ methods — prefer small, focused interfaces
- **Error wrapping:** Use `fmt.Errorf("context: %w", err)` to preserve the error chain
- **Context propagation:** Functions that accept `context.Context` should pass it through, not create new ones
- **Table-driven tests:** Prefer table-driven tests over repetitive test functions
- **Package layout:** Follow standard Go conventions — don't fight the language
