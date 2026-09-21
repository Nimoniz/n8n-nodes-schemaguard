# Publish checklist

Before the first public release:

1. Replace every `YOUR_*` placeholder in `package.json` and README links.
2. Create a public GitHub repository named `n8n-nodes-schemaguard`.
3. Run:

```bash
npm install
npm run build
npm test
npm run lint
npm pack --dry-run
```

4. Verify the generated package contains only the expected `dist` files plus package metadata.
5. Create or log into an npm account.
6. Check that the package name is still available:

```bash
npm view n8n-nodes-schemaguard
```

A 404 means the name is not currently published.

7. Authenticate:

```bash
npm login
```

8. Publish:

```bash
npm publish --access public
```

9. Install the published package on a clean n8n test instance and repeat the baseline/type-drift test.
10. Tag the GitHub release as `v0.3.0` only after the clean-install test passes.

## Do not publish yet if

- `npm run lint` fails
- tests fail
- the README contains placeholder repository links
- the package accidentally includes test payloads or private data
