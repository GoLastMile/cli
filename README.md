# LastMile

> Ship your vibe-coded projects to production with confidence.

LastMile is a CLI tool that analyzes your codebase for production readiness gaps and helps you fix them before deploying. Built for developers who move fast but want to ship responsibly.

## Quick Start

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/GoLastMile/cli/main/install.sh | bash

# Analyze your project
cd your-project
lastmile analyze
```

## Why LastMile?

You've built something amazing with AI-assisted coding. But before it goes live, there are dozens of production concerns to address: security, logging, error handling, CI/CD, and more.

LastMile scans your project and tells you exactly what's missing, with actionable fixes:

- **Security gaps** - Input validation, API key handling, rate limiting
- **Testing gaps** - Missing tests, no test framework, no coverage
- **Observability gaps** - No logging, no error tracking, no metrics
- **CI/CD gaps** - No pipeline, no deployment config
- **Dependency issues** - Missing lock files, outdated packages

## Installation

### Homebrew (macOS/Linux)

```bash
brew tap golastmile/tap
brew install lastmile
```

### Shell Script

```bash
curl -fsSL https://raw.githubusercontent.com/GoLastMile/cli/main/install.sh | bash
```

### From Source

```bash
git clone https://github.com/GoLastMile/cli.git
cd cli && pnpm install && pnpm build
```

## Usage

### Analyze

Scan your project for production readiness gaps:

```bash
lastmile analyze
```

Output:

```
╭────────────────────────────────────────╮
│  Readiness Score: 45/100  Needs Work   │
│    ██████████████░░░░░░░░░░░░░░░░      │
╰────────────────────────────────────────╯

 CRITICAL  1 issue
┌─────────────────────────────────────────────┬────────────────────────────────────────┐
│ ✗ API keys may not be hashed                │ Hash API keys using SHA-256 or bcrypt  │
└─────────────────────────────────────────────┴────────────────────────────────────────┘

 WARNING  3 issues
┌─────────────────────────────────────────────┬────────────────────────────────────────┐
│ ⚠ No test files found                       │ Add tests for critical business logic  │
├─────────────────────────────────────────────┼────────────────────────────────────────┤
│ ⚠ No structured logging                     │ Add pino or winston for logging        │
├─────────────────────────────────────────────┼────────────────────────────────────────┤
│ ⚠ Missing .env.example                      │ Document required environment vars     │
└─────────────────────────────────────────────┴────────────────────────────────────────┘
```

### Fix

Auto-fix detected issues:

```bash
# Preview what will be fixed
lastmile fix

# Apply fixes
lastmile fix --apply
```

### Ship

Deploy to cloud platforms (coming soon):

```bash
lastmile ship --platform railway
lastmile ship --platform vercel
```

## Supported Stacks

LastMile auto-detects your stack and tailors its analysis:

| Language | Frameworks |
|----------|------------|
| TypeScript/JavaScript | Next.js, Express, Fastify, Hono |
| Python | FastAPI, Django, Flask |
| Go | Standard library, Gin, Echo |
| Ruby | Rails, Sinatra |
| Rust | Actix, Axum |

## Commands

| Command | Description |
|---------|-------------|
| `lastmile analyze` | Analyze project for production gaps |
| `lastmile fix` | Auto-fix detected issues |
| `lastmile ship` | Deploy to cloud platforms |
| `lastmile login` | Authenticate with LastMile |
| `lastmile logout` | Clear authentication |

## Options

```
-d, --dir <path>    Directory to analyze (default: .)
--json              Output as JSON for CI/CD integration
--no-banner         Skip the ASCII art banner
-v, --verbose       Show detailed analysis
```

## CI/CD Integration

Add LastMile to your CI pipeline:

```yaml
# .github/workflows/lastmile.yml
name: Production Readiness
on: [push, pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install LastMile
        run: curl -fsSL https://raw.githubusercontent.com/GoLastMile/cli/main/install.sh | bash
      - name: Analyze
        run: lastmile analyze --json
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

---

Built with care for developers who ship fast.
