# Releasing `@mcpup/cli`

Two-step model: a **one-time manual first publish**, then **automated releases on tag** via
OIDC trusted publishing (no token, no OTP, provenance included).

## 1. First publish (manual, once)

OIDC trusted publishing can only be attached to a package that already exists, so the very
first version is published by hand.

```bash
npm login                       # web-based, 2FA included
cd packages/cli
npm publish --otp=XXXXXX         # your authenticator code; prepublishOnly rebuilds dist
```

This creates the `@mcpup` scope and the public package. Verify:

```bash
npm view @mcpup/cli version
npx @mcpup/cli --version
```

## 2. Enable trusted publishing (once, on npmjs.com)

On **npmjs.com → `@mcpup/cli` → Settings → Trusted Publisher → GitHub Actions**, add:

- Organization / user: `sv-LayZ`
- Repository: `mcp-check`
- Workflow filename: `release.yml`
- Environment: *(leave empty)*

No `NPM_TOKEN` secret is needed anymore — you can delete it from the repo.

## 3. Subsequent releases (automated)

Bump the version, then push a matching tag. [.github/workflows/release.yml](.github/workflows/release.yml)
runs tests, builds the Node bundle, and publishes with provenance.

```bash
# bump packages/cli/package.json "version" to e.g. 0.2.0, commit, then:
git tag v0.2.0
git push origin v0.2.0
```

The workflow guards that the tag (`v0.2.0`) matches `packages/cli/package.json` version.

## Fallback: automation token (no OIDC)

If you'd rather not use trusted publishing, create a classic **Automation** token on npm
(it bypasses 2FA/OTP), store it as the `NPM_TOKEN` repo secret, and change the publish step to:

```yaml
      - name: Publish @mcpup/cli
        working-directory: packages/cli
        run: npm publish            # drop --provenance (tokens can't attest provenance)
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
