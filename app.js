import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();
import fs from "fs";
import http from "http";
import url from "url";
import { Octokit, App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import { routes } from "./src/routes.js";
import {
  verifyGitHubAppAuthenticationAndAccess,
  getMessage,
  isCLARequired,
  isMessageAfterMergeRequired,
} from "./src/helpers.js";

try {
  const packageJson = await import("./package.json", {
    assert: { type: "json" },
  });
  var APP_VERSION = packageJson.default.version;
} catch (err) {
  console.error("Failed to get the version number");
}
console.log(`Application version: ${APP_VERSION}`);
console.log(`Website address: ${process.env.WEBSITE_ADDRESS}`);

// Set configured values
const appId = process.env.APP_ID;
// To add GitHub App Private Key directly as a string config (instead of file), convert it to base64 by running following command
// openssl base64 -in /path/to/original-private-key.pem -out ./base64EncodedKey.txt -A
// Then set GITHUB_APP_PRIVATE_KEY_BASE64 environment variable with the value of ./base64EncodedKey.txt content
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY_BASE64
  ? Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString(
      "utf8"
    )
  : null;
const privateKey =
  GITHUB_APP_PRIVATE_KEY ||
  fs.readFileSync(
    process.env.PRIVATE_KEY_PATH || "./GITHUB_APP_PRIVATE_KEY.pem",
    "utf8"
  );
const secret = process.env.WEBHOOK_SECRET;
const enterpriseHostname = process.env.ENTERPRISE_HOSTNAME;

// Create an authenticated Octokit client authenticated as a GitHub App
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret,
  },
  ...(enterpriseHostname && {
    Octokit: Octokit.defaults({
      baseUrl: `https://${enterpriseHostname}/api/v3`,
    }),
  }),
});
await verifyGitHubAppAuthenticationAndAccess(app);

// Optional: Get & log the authenticated app's name
const { data } = await app.octokit.request("/app");

// Read more about custom logging: https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${data.name}'`);

// Subscribe to the "pull_request.opened" webhook event
app.webhooks.on("pull_request.opened", async ({ octokit, payload }) => {
  console.log(
    `Received a pull request event for #${payload.pull_request.number} by ${payload.pull_request.user.type}: ${payload.pull_request.user.login}`
  );
  try {
    if (!isCLARequired(payload.pull_request)) {
      console.log("CLA not required for this PR");
      return;
    }
    // If the user is not a member of the organization and haven't yet signed CLA,
    // Add a label to the PR
    octokit.rest.issues.addLabels({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.pull_request.number,
      labels: ["Pending CLA"],
    });
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
      );
    } else {
      console.error(error);
    }
  }
});

app.webhooks.on("pull_request.labeled", async ({ octokit, payload }) => {
  const { number, pull_request, label, sender, repository, action } = payload;
  console.log(
    `Label #${label.name} ${action} by ${sender.login} on ${pull_request.issue_url} : ${pull_request.title}`
  );
  try {
    if (label.name === "Pending CLA") {
      console.log("Adding comment to the issue/PR to ask for CLA signature");
      //  ask them to sign the CLA
      const comment = getMessage("ask-to-sign-cla", {
        username: pull_request.user.login,
        org: repository.owner.login,
        repo: repository.name,
        pr_number: pull_request.number,
      });
      // Docs for octokit.rest.issues.createComment - https://github.com/octokit/plugin-rest-endpoint-methods.js/blob/main/docs/issues/createComment.md
      await octokit.rest.issues.createComment({
        owner: repository.owner.login,
        repo: repository.name,
        issue_number: pull_request.number,
        body: comment,
      });
    }
    if(label.name?.toLowerCase() === "product review") {
      console.log("Sending message to the product review channel");
      const message = `:mag: <${pull_request.html_url}|#${pull_request.number}: ${pull_request.title}> by ${pull_request.user.login}`;
      await Slack.sendMessage(message);
    }
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
      );
    } else {
      console.error(error);
    }
  }
});

app.webhooks.on("pull_request.closed", async ({ octokit, payload }) => {
  console.log(
    `Closed a pull request event for #${payload.pull_request.number}`
  );
  if (!payload.pull_request.merged) return;
  console.log(`This PR is merged`);
  try {
    if (!isMessageAfterMergeRequired(payload.pull_request)) {
      return;
    }
    console.log(`Going to notify the PR author...`);
    const comment = getMessage("message-after-merge", {
      username: payload.pull_request.user.login,
      org: payload.repository.owner.login,
      repo: payload.repository.name,
      pr_number: payload.pull_request.number,
    });
    // Docs for octokit.rest.issues.createComment - https://github.com/octokit/plugin-rest-endpoint-methods.js/blob/main/docs/issues/createComment.md
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner,
      repo: payload.repository.name,
      issue_number: payload.pull_request.number,
      body: comment,
    });
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
      );
    } else {
      console.error(error);
    }
  }
});

app.webhooks.on("issues.opened", async ({ octokit, payload }) => {
  console.log(`Received a new issue event for #${payload.issue.number}`);
  try {
    // Docs for octokit.rest.issues.createComment - https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs/issues/createComment.md
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: "Thanks for opening this issue! We'll get back to you shortly. If it is a bug, please make sure to add steps to reproduce the issue.",
    });
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
      );
    } else {
      console.error(error);
    }
  }
});

app.webhooks.on("push", async ({ payload }) => {
  // Pull out the branch and repo name from the payload
  const branch = payload.ref.split("/").pop();
  const repo = payload.repository.name;
  console.log(`Received a push event on ${branch} branch of ${repo}`);
});

// Optional: Handle errors
app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    // Log Secret verification errors
    console.log(`Error processing request: ${error.event}`);
  } else {
    console.log(error);
  }
});

// Launch a web server to listen for GitHub webhooks
const port = process.env.PORT || 3000;
const webhookPath = "/api/webhook";
const localWebhookUrl = `http://localhost:${port}${webhookPath}`;

// See https://github.com/octokit/webhooks.js/#createnodemiddleware for all options
const middleware = createNodeMiddleware(app.webhooks, { path: webhookPath });

http
  .createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    const pathWithoutQuery = parsedUrl.pathname;
    const queryString = parsedUrl.query;
    console.log(req.method + " " + pathWithoutQuery);
    if (queryString) console.log(queryString.substring(0, 20) + "...");
    switch (req.method + " " + pathWithoutQuery) {
      case "GET /":
        routes.home(req, res);
        break;
      case "GET /cla":
        routes.cla(req, res);
        break;
      case "GET /download":
        routes.downloadCenter(req, res);
        break;
      case "POST /download":
        routes.download(req, res);
        break;
      case "POST /cla":
        routes.submitCla(req, res, app);
        break;
      case "GET /contributions/sync":
        routes.syncPullRequests(req, res, app);
        break;
      case "GET /contributions":
        routes.listPullRequests(req, res, app);
        break;
      case "GET /contributions/pr":
        routes.getPullRequestDetail(req, res, app);
        break;
      case "GET /contributions/reset":
        routes.resetContributionData(req, res, app);
        break;
      case "POST /api/webhook":
        middleware(req, res);
        break;
      default:
        routes.default(req, res);
    }
  })
  .listen(port, () => {
    console.log(`Server is listening for events at: ${localWebhookUrl}`);
    console.log(
      "Server is also serving the homepage at: http://localhost:" + port
    );
    console.log("Press Ctrl + C to quit.");
  });
