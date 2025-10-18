# Rudder GitHub App

A Node.js server for GitHub app to assist external contributors and save maintainers' time

## Roadmap

- [x] When an external contributor (not the internal team) raises a PR, post a comment to sign CLA and label PR `Pending CLA`
- [x] On signing CLA, remove `Pending CLA` label from all the PRs of that user. Never ask that user to sign the CLA on any of our repo in future
- [x] On `rudder-transformer` PR merge, post a comment to raise PR in `integrations-config`
- [ ] On `integrations-config` PR merge, post a comment to join Slack's product-releases channel to get notified when that integration goes live
- [ ] On `integrations-config` PR merge, post a comment to raise PR in `rudder-docs`
- [x] List of open PRs by external contributors
- [x] Notify on Slack when `product review` label is added to a PR
- [ ] Analyze merged PRs and suggest next actions
- [x] Analyze docs pages using AI on PR labelled with `docs review`

## Features

### Next Actions Feature

The Next Actions feature automatically analyzes merged pull requests from external contributors and suggests next actions based on the code changes. Here's how it works:

1. **Triggers**: Listens to `pull_request.closed` events and checks if the PR was merged
2. **Analysis**: Extracts production code changes (excludes test files)
3. **External API**: Sends changes to services such as DocsAgent
4. **Comments**: Posts the API response as a comment on the PR

## Requirements

- Node.js 20 or higher
- A GitHub App subscribed to **Pull Request** events and with the following permissions:
  - Pull requests: Read & write
  - Metadata: Read-only
- Your GitHub App Webhook must be configured to receive events at a URL that is accessible from the internet.
- (Only for local development) A tunnel to expose your local server to the internet (e.g. [smee](https://smee.io/), [ngrok](https://ngrok.com/) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/local/))

## Development setup

1. Clone this repository.
2. Create a `.env` file similar to `.env.example` and set actual values. If you are using GitHub Enterprise Server, also include a `ENTERPRISE_HOSTNAME` variable and set the value to the name of your GitHub Enterprise Server instance.
3. Install dependencies with `npm install`.
4. Start the server with `npm run server`.
5. Ensure your server is reachable from the internet. This is necessary for GitHub to send webhook events to your local server.
    - If you're using `smee`, run `smee -u <smee_url> -t http://localhost:3000/api/webhook`.
6. Ensure your GitHub App includes at least one repository on its installations.

## Deployment

### Using `Docker`

1. [Register a GitHub app](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) for your GitHub organization. Make sure to activate the webhook with webhook url `https://YOUR_WEBSITE/api/webhook` in your app with a secret. Enable Permissions & Events as you may need, at minimum pull_request and issue related events should be enabled.
2. Install your GitHub app in all the repos where you need this app.
3. Clone this repo OR download the [`build/docker-compose.yml`](./build/docker-compose.yml) to install via dockerhub image
4. Update the `docker-compose.yml` file with the environment variables obtained from step 2. Make sure to replace placeholder values with your actual GitHub App details.
5. To convert GitHub App's private key to base64, use this command:
   ```
   openssl base64 -in /path/to/original-private-key.pem -out ./base64EncodedKey.txt -A
   ```
6. Run `docker-compose build` to build the service
7. Run `docker-compose up` to create and start the container
8. Test by visiting `http://localhost:3000` OR whatever `WEBSITE_ADDRESS` environment variable you've configured

## Advanced Features Setup

### Docs Agent Setup

To set up the Docs Agent feature:

1. Locate your Docs Agent API project. This is a separate service that analyzes documentation and provides suggestions.
2. In the Docs Agent API project's environment configuration, add the following URL to the `ALLOWED_WEBHOOK_URLS` variable:
   ```
   https://your-github-app-host.com/api/comment
   ```
   Replace `your-github-app-host.com` with the actual hostname where your GitHub App is deployed.

This setup allows the Docs Agent to send webhook requests to your GitHub App.

## How It Works

With your server running, you can now create a pull request on any repository that
your app can access. GitHub will emit a `pull_request.opened` event and will deliver
the corresponding Webhook [payload](https://docs.github.com/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request) to your server.

The server in this example listens for `pull_request.opened` events and acts on
them by creating a comment on the pull request, with the message in `message.md`,
using the [octokit.js rest methods](https://github.com/octokit/octokit.js#octokitrest-endpoint-methods).

## Security considerations

To keep things simple, this example reads the `GITHUB_APP_PRIVATE_KEY` from the
environment. A more secure and recommended approach is to use a secrets management system
like [Vault](https://www.vaultproject.io/use-cases/key-management), or one offered
by major cloud providers:
[Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-node?tabs=windows),
[AWS Secrets Manager](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-secrets-manager/),
[Google Secret Manager](https://cloud.google.com/nodejs/docs/reference/secret-manager/latest),
etc.

## References

- [Docs - octokit.rest.* methods](https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs)
- [Docs - GitHub API](https://docs.github.com/en/rest)