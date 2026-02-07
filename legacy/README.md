# Legacy Archive

This directory contains the pre-rewrite JSON-backed runtime and tests kept for historical reference only.

Rules:
- Code under `legacy/` is not part of the active runtime path.
- CI quality gates do not require `legacy/` tests.
- Use `pnpm test:legacy` only when you intentionally want to run archived tests.
- New product or architecture changes must be implemented in `src/`, not in `legacy/`.
