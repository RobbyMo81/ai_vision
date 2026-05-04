# Contributing to ai-vision

Thank you for your interest in contributing to **ai-vision**! We welcome contributions from the community to help make this AI-driven browser automation platform better for everyone.

## Ways to Contribute

1.  **Reporting Bugs:** Open an issue on GitHub. Please include a clear description of the bug, steps to reproduce it, and your environment details (Node.js version, OS, etc.).
2.  **Suggesting Enhancements:** If you have an idea for a new feature or engine, open an issue to discuss it.
3.  **Code Contributions:**
    *   Fork the repository.
    *   Create a new branch for your feature or bug fix.
    *   Ensure your code follows the existing style and conventions.
    *   Run `pnpm run typecheck` and `pnpm test` to ensure quality.
    *   Submit a Pull Request with a clear description of your changes.

## Development Setup

See the [README.md](README.md) for detailed installation and setup instructions.

### Quality Gates

Before submitting a PR, please ensure the following commands pass:

```bash
pnpm run build
pnpm run typecheck
pnpm test
```

## Governance

This project follows the **FORGE** governance model for workflow management and enhancement tracking. See [FORGE.md](FORGE.md) for more details.

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## License

By contributing to ai-vision, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
