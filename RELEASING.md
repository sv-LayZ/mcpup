# Releasing `@mcpup/cli` and `@mcpup/core`

Two packages ship from this repo: `@mcpup/core` (bundled by the CLI, also public)
and `@mcpup/cli`. Both follow the same model: a **one-time manual first publish**,
then **automated releases on tag** via OIDC trusted publishing (no token, no OTP,
provenance included).

## 1. First publish (manual, once per package)

OIDC trusted publishing can only be attached to a package that already exists, so the
very first version of each package is published by hand.

```bash
npm login                            # web-based, 2FA included

# @mcpup/core (currently 0.1.0)
cd packages/core
npm publish --otp=XXXXXX --access public   # prepublishOnly rebuilds dist

# @mcpup/cli (currently 0.1.1)
cd ../cli
npm publish --otp=XXXXXX --access public
```

This creates the `@mcpup` scope and the public packages. Verify:

```bash
npm view @mcpup/core version
npm view @mcpup/cli version
npx @mcpup/cli --version
```

> `@mcpup/cli` 0.1.0 is already published; `@mcpup/core` still needs its first
> manual publish before trusted publishing can work for it.

## 2. Enable trusted publishing (once, on npmjs.com, per package)

For **both** `@mcpup/core` and `@mcpup/cli`, on
**npmjs.com → `<package>` → Settings → Trusted Publisher → GitHub Actions**, add:

- Organization / user: `sv-LayZ`
- Repository: `mcpup`
- Workflow filename: `release.yml`
- Environment: *(leave empty)*

> The repo was renamed `mcp-check` → `mcpup`; make sure any existing trusted
> publisher config points at `mcpup`, not the old name.

No `NPM_TOKEN` secret is needed — you can delete it from the repo.

## 3. Subsequent releases (automated)

Bump the version, then push a matching tag. [.github/workflows/release.yml](.github/workflows/release.yml)
runs tests, builds the Node bundle, and publishes both packages with provenance via OIDC.
`@mcpup/core` is skipped automatically if its current version is already on npm.

```bash
# bump packages/cli/package.json "version" to e.g. 0.2.0, commit, then:
git tag v0.2.0
git push origin v0.2.0
```

The workflow guards that the tag (`v0.2.0`) matches `packages/cli/package.json` version.

## Fallback: automation token (no OIDC)

If you'd rather not use trusted publishing, create a classic **Automation** token on npm
(it bypasses 2FA/OTP), store it as the `NPM_TOKEN` repo secret, and change each publish step to
use a token (and drop `--provenance`, since tokens can't attest provenance):

```yaml
      - name: Publish @mcpup/cli
        working-directory: packages/cli
        run: npm publish --access public   # no --provenance with a token
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
