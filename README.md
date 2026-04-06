# LastMile CLI

Ship your vibe-coded projects to production with confidence.

LastMile analyzes your codebase for production readiness gaps and helps you fix them before deploying.

## Installation

### Homebrew (macOS/Linux)

```bash
brew tap golastmile/tap
brew install lastmile
```

### Direct Download

```bash
curl -fsSL https://raw.githubusercontent.com/GoLastMile/cli/main/install.sh | bash
```

### From Source

```bash
git clone https://github.com/GoLastMile/cli.git
cd cli
pnpm install
pnpm build
```

## Usage

### Analyze Your Project

```bash
lastmile analyze
```

This scans your project and reports production readiness gaps across categories:
- **Security** - API key handling, input validation, rate limiting
- **Testing** - Test coverage, test framework setup
- **Observability** - Logging, error tracking, metrics
- **CI/CD** - Pipeline configuration, deployment setup
- **Dependencies** - Lock files, audit scripts, version constraints

### Fix Issues

```bash
# Preview fixes
lastmile fix

# Apply fixes automatically
lastmile fix --apply

# Interactive mode
lastmile fix --interactive
```

### Deploy

```bash
# Deploy to Railway
lastmile ship --platform railway

# Deploy to Vercel
lastmile ship --platform vercel
```

## Commands

| Command | Description |
|---------|-------------|
| `lastmile analyze` | Analyze project for production gaps |
| `lastmile fix` | Auto-fix detected issues |
| `lastmile ship` | Deploy to cloud platforms |
| `lastmile login` | Authenticate with LastMile |
| `lastmile logout` | Clear authentication |

## Options

### Global Options

- `-d, --dir <path>` - Directory to analyze (default: current directory)
- `--json` - Output results as JSON
- `-v, --verbose` - Show detailed output

### Analyze Options

- `--no-banner` - Skip the ASCII banner

### Fix Options

- `--apply` - Apply fixes without preview
- `-y, --yes` - Skip confirmation prompts
- `--interactive` - Guided fix mode

## Example Output

```
╭────────────────────────────────────────╮
│  Readiness Score: 45/100  Needs Work   │
│                                        │
│    ██████████████░░░░░░░░░░░░░░░░      │
╰────────────────────────────────────────╯

 CRITICAL  2 issues
┌─────────────────────────────────────────────┬────────────────────────────────────────┐
│ ✗ Missing .gitignore file                   │ Create a .gitignore file appropriate   │
│                                             │ for your stack                         │
├─────────────────────────────────────────────┼────────────────────────────────────────┤
│ ✗ No input validation                       │ Add input validation using Zod or Joi  │
└─────────────────────────────────────────────┴────────────────────────────────────────┘
```

## Requirements

- Node.js 18+ (for development only)
- The binary releases have no runtime dependencies

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build
pnpm build

# Build standalone binaries
pnpm build:binary:all
```

## Related

- [LastMile Backend](https://github.com/GoLastMile/backend) - Analysis API server

## License

MIT
