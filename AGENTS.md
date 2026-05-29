# Project Agent Guidelines

This project uses a local, project-scoped subset of ECC skills copied into
`.agents/skills/`.

Do not run ECC global install/sync scripts, install global git hooks, modify
`~/.codex`, or enable MCP servers for this project unless the user explicitly
asks for that specific change.

## Local ECC Skills

When a task matches one of these areas, read only the relevant `SKILL.md` file
before acting:

- `python-testing`: pytest strategy, fixtures, mocking, parametrization, and coverage.
- `python-patterns`: Python implementation patterns and project structure guidance.
- `backend-patterns`: backend architecture, service/repository boundaries, caching, and API concerns.
- `api-design`: REST API contracts, status codes, pagination, filtering, and error responses.
- `security-review`: authentication, authorization, user input, secrets, file upload, and sensitive data review.
- `verification-loop`: build, lint, typecheck, test, security scan, and diff review after material changes.
- `search-first`: research existing libraries, APIs, and patterns before writing custom integrations.
- `strategic-compact`: context management for large or long-running tasks.
- `token-budget-advisor`: keep context use proportional to the task.
- `repo-scan`: structured repository onboarding and codebase surface scan.

## Working Rules

- Prefer the existing project code and tests over generic ECC advice.
- Treat ECC skills as guidance, not as commands to install tools or change global state.
- Keep changes scoped to the user's request.
- After code changes, run the smallest meaningful verification command available.
- If verification cannot run because the project lacks dependencies or config, report that clearly.
