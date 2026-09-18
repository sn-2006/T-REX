
# Contributing to T-REX

Thank you for your interest in contributing to T-REX!

T-REX is a project focused on building a reliable and user-friendly solution. We welcome contributions that improve the functionality, usability, documentation, and overall quality of the project.

## Getting Started

### 1. Fork the Repository

Fork the T-REX repository to your GitHub account.

### 2. Clone the Repository

```bash
git clone https://github.com/sn-2006/T-REX.git
cd T-REX
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file based on `.env.example`.

Do not commit API keys, passwords, tokens, or other sensitive information.

### 5. Run the Project

```bash
npm run dev
```

Follow the project README for additional setup instructions.

## Branching Strategy

We use feature branches to keep development organized.

### Branch Naming

- `feature/frontend` — Frontend features and UI improvements.
- `feature/backend` — Backend and API development.
- `feature/blockchain` — Blockchain-related development.
- `docs/documentation` — Documentation changes.
- `fix/bug-description` — Bug fixes.

Create a branch from `main`:

```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

## Making Changes

1. Create a new branch from `main`.
2. Make your changes.
3. Test your changes locally.
4. Update documentation if required.
5. Commit your changes with a meaningful message.
6. Push your branch to GitHub.
7. Open a Pull Request.

## Commit Guidelines

Use clear and meaningful commit messages.

Examples:

```text
feat: add transaction dashboard
fix: resolve wallet connection issue
docs: update project setup guide
refactor: improve transaction processing
test: add transaction validation tests
chore: update dependencies
```

## Pull Request Guidelines

Before opening a Pull Request:

- Ensure the project builds successfully.
- Test the changes locally.
- Keep the Pull Request focused on one feature or fix.
- Explain what was changed and why.
- Include screenshots for UI changes when relevant.
- Mention any known limitations.

## Issue Tracking

Before starting work, check existing GitHub Issues to avoid duplicate work.

When creating an issue, include:

- A clear title.
- A description of the problem or feature.
- Steps to reproduce, if applicable.
- Expected and actual behavior.
- Screenshots or logs when useful.

## Code Quality

- Follow the existing project structure.
- Write readable and maintainable code.
- Avoid committing unnecessary files.
- Never commit secrets or credentials.
- Keep documentation updated.

## Questions and Support

If you have questions or suggestions, open a GitHub Issue or contact the project maintainers.

Thank you for contributing to T-REX!