# Release setup

The production flow is:

```text
Merge to main → CI checks → finalize news → release commit + annotated tag
                                                        ↓ tag push
                  Deploy & Release → checks → build → relay → Pages → GitHub release
```

`ci.yml` runs PR checks and prepares releases after a checked merge. `deploy.yml` runs only for release tags (or an explicit dispatch against a tag). Both use `checks.yml`. `server-setup.yml` remains a separate manual operation on `main`.

## 1. Register and install the release App

In the GitHub account that owns `denzrs/slingshot-remake`, open [Settings → Developer settings → GitHub Apps → New GitHub App](https://github.com/settings/apps/new).

- **GitHub App name:** for example `Slingshot Release denzrs` (GitHub requires a unique name).
- **Homepage URL:** `https://github.com/denzrs/slingshot-remake`.
- Under **Webhook**, deselect **Active**.
- Under **Repository permissions**, set **Contents → Read and write**. Metadata read access is automatic. The App does not need Actions, Administration, Workflows, user authorization or a callback URL.
- **Where can this GitHub App be installed? → Only on this account**.
- Click **Create GitHub App**.

On the App's settings page, note its **Client ID**. Under **Private keys**, click **Generate a private key**; GitHub downloads a `.pem` file.

Choose **Install App**, select the repository owner account, and install it with **Only select repositories → slingshot-remake**. This is a dedicated installed App, rather than the built-in GitHub Actions integration.

## 2. Give that App a Ruleset bypass

Open [Repository Settings → Rules → Rulesets](https://github.com/denzrs/slingshot-remake/settings/rules), edit **Rules**, and use **Bypass list → Add bypass**. Select your newly installed release App and choose **Always allow**, then save. A pull-request-only bypass cannot authorize the direct release commit.

Keep the other Ruleset rules and bypass entries. The workflow's release commit changes only `src/news/releases.json` (or is empty when there is no news), and its tag points to the same commit. The App gets no permission to edit repository settings.

## 3. Configure repository Actions values

Open [Settings → Secrets and variables → Actions](https://github.com/denzrs/slingshot-remake/settings/secrets/actions).

| Type | Name | Value |
| --- | --- | --- |
| Repository variable, under **Variables** | `RELEASE_APP_CLIENT_ID` | The App's **Client ID**, not the numeric App ID or a client secret |
| Repository secret, under **Secrets** | `RELEASE_APP_PRIVATE_KEY` | The entire downloaded `.pem` file, including its BEGIN/END lines |

Enter the private key directly into GitHub's secret form. The workflow creates a token scoped to this repository and `Contents: write` only for the preparation job. The official token action revokes it at job cleanup. The bundle, test and deployment jobs use their own normal `GITHUB_TOKEN` permissions.

The repository's **Actions → General → Workflow permissions** default can stay read-only. The option to let Actions create/approve pull requests is not needed for this flow.

## 4. Allow deployments from release tags

Open [Settings → Environments](https://github.com/denzrs/slingshot-remake/settings/environments) and configure **Deployment branches and tags → Selected branches and tags**:

- **github-pages:** add a rule with **Ref type → Tag**, pattern `v*`.
- **ionos-production:** add a **Tag** rule `v*`; keep a **Branch** rule `main` for manual server setup.

Branch and tag rules must be added separately. Keep existing environment secrets, variables and approval requirements. Pages must use **GitHub Actions** as its publishing source.

## Release behavior and recovery

- CI runs the checks before accessing any App credentials. PR jobs never request a release token.
- A release creates `chore(release): vX.Y.Z` with a `Release-Source` trailer and an annotated tag. The push is atomic: a rejected branch update cannot publish its tag. There is no force push.
- Do not add `[skip ci]`: it can also suppress the tag-triggered workflow. The main CI recognizes a generated commit by its parent, trailer, tag and changed files, then skips further release preparation.
- Preparation is serialized. If `main` advanced during checks or during the push, that older run leaves the release to the newer checked run. All merged changes remain included.
- Re-running CI for an already prepared source reuses its commit and tag. If the tag pipeline fails, re-run **Slingshot Deploy & Release** in Actions; do not delete or move the tag.
- Deployment runs queue and only the highest version tag reachable from `main` deploys. Re-running an older tag can rebuild its release assets without rolling back production.
- The relay compares the uploaded binary and configuration with the files on the VPS and keeps an identical active service running. Pages and the GitHub release publish only after the required relay deployment succeeds.
- To dispatch a release workflow manually, use `gh workflow run deploy.yml --ref vX.Y.Z`. A dispatch against a branch is rejected.
- For a manual release tag, finalize the news with `node scripts/finalize-news.mjs --finalize vX.Y.Z`, commit the JSON through the normal review flow, and tag the merged commit. The tag pipeline requires the tag's commit to be part of `main` and the draft to be cleared.

Check the Git orchestration locally with `npm run release:check`; it uses disposable local repositories and a stub systemd command, never the production repository or VPS.

References: [Registering an App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), [App tokens in Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow), [workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [Ruleset bypass](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [concurrency queues](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
