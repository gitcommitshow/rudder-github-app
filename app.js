import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();
import fs from "fs";
import http from "http";
import url from "url";
import { routes } from "./src/routes.js";
import GitHub from "./src/services/GitHub.js";
import Slack from "./src/services/Slack.js";
import {
  getMessage,
  isCLARequired,
  isMessageAfterMergeRequired,
  getWebsiteAddress,
} from "./src/helpers.js";
import DocsAgent from "./src/services/DocsAgent.js";

try {
  const packageJson = await import("./package.json", {
    with: { type: "json" },
  });
  var APP_VERSION = packageJson.default.version;
} catch (err) {
  console.error("Failed to get the version number");
}
console.log(`Application version: ${APP_VERSION}`);

function bootstrapGitHubApp(){
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
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const enterpriseHostname = process.env.ENTERPRISE_HOSTNAME;
  // Create an authenticated Octokit client authenticated as a GitHub App
  GitHub.authenticateApp(appId, privateKey, webhookSecret, enterpriseHostname);
}

bootstrapGitHubApp();
await GitHub.verifyGitHubAppAuthenticationAndAccess();
// Optional: Get & log the authenticated app's name
const data = await GitHub.getAppInfo();

// Read more about custom logging: https://github.com/octokit/core.js#logging
GitHub.app.octokit.log.debug(`Authenticated as '${data.name}'`);

// Subscribe to the "pull_request.opened" webhook event
GitHub.app.webhooks.on("pull_request.opened", async ({ octokit, payload }) => {
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

GitHub.app.webhooks.on("pull_request.labeled", async ({ octokit, payload }) => {
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
    if(label.name?.toLowerCase() === "product review" && Slack.isConfigured()) {
      console.log("Sending message to the product review channel");
      const message = `:mag: <${pull_request.html_url}|#${pull_request.number}: ${pull_request.title}> by ${pull_request.user?.login}`;
      await Slack.sendMessage(message);
    }
    if(label.name?.toLowerCase() === "docs review") {
      console.log("Processing docs review for this PR");
      try {
        const DOCS_REPOS = process.env.DOCS_REPOS?.split(",")?.map((item) => item?.trim()) || [];
        if(DOCS_REPOS?.length > 0 && !DOCS_REPOS.includes(repository.name)) {
          throw new Error("Docs agent review is not available for this repository");
        }
        if(!DocsAgent.isConfigured()) {
          throw new Error("Docs agent service is not configured");
        }
        console.log("Going to analyze the docs pages in this PR");
        // Get PR changes
        const prChanges = await GitHub.getPRChanges(
          repository.owner.login,
          repository.name,
          pull_request.number
        );
        const docsFiles = prChanges.files.filter((file) => file.filename.endsWith(".md"));
        console.log(`Found ${docsFiles.length} docs files being changed`);
        if(docsFiles.length === 0) {
          throw new Error("No docs files being changed in this PR");
        }
        for(const file of docsFiles) {
          const content = file.content;
          // Convert relative file path to full remote github file path using PR head commit SHA https://raw.githubusercontent.com/gitcommitshow/rudder-github-app/e14433e76d74dc680b8cf9102d39f31970e8b794/.codesandbox/tasks.json
          const relativePath = file.filename;
          const fullPath = `https://raw.githubusercontent.com/${repository.owner.login}/${repository.name}/${prChanges.headCommit}/${relativePath}`;
          const webhookUrl = process.env.API_POST_GITHUB_COMMENT || (getWebsiteAddress() + "/api/comment");//TODO: add this url to `ALLOWED_WEBHOOK_URLS` env of docs-agent project
          DocsAgent.reviewDocs(content, fullPath, {
            webhookUrl: webhookUrl,
            webhookMetadata: {
              issue_number: pull_request.number,
              repo: repository.name,
              owner: repository.owner.login,
            },
          });
          console.log(`Successfully started docs review for ${fullPath}, results will be handled by webhook: ${webhookUrl}`);
        }
        console.log(`Successfully started all necessary docs reviews for PR ${repository.name} #${pull_request.number}`);
      } catch (error) {
        console.error(error);
      }
    }
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response?.status}. Message: ${error.response?.data?.message}`
      );
    } else {
      console.error(error);
    }
  }
});

GitHub.app.webhooks.on("pull_request.closed", async ({ octokit, payload }) => {
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

GitHub.app.webhooks.on("issues.opened", async ({ octokit, payload }) => {
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

GitHub.app.webhooks.on("push", async ({ payload }) => {
  // Pull out the branch and repo name from the payload
  const branch = payload.ref.split("/").pop();
  const repo = payload.repository.name;
  console.log(`Received a push event on ${branch} branch of ${repo}`);
});

// Optional: Handle errors
GitHub.app.webhooks.onError((error) => {
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
const publicWebhookUrl = getWebsiteAddress() + webhookPath;

// See https://github.com/octokit/webhooks.js/#createnodemiddleware for all options
const githubWebhookRequestHandler = GitHub.getWebhookRequestHandler(webhookPath);

const server = http
  .createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    const pathWithoutQuery = parsedUrl.pathname;
    const queryString = parsedUrl.query;
    console.log(req.method + " " + pathWithoutQuery);
    if (queryString) console.log(queryString.substring(0, 20) + "...");
    switch (req.method + " " + pathWithoutQuery) {
      case "POST /api/webhook":
        githubWebhookRequestHandler(req, res);
        break;
      case "POST /api/comment":
        routes.addCommentToGitHubIssueOrPR(req, res);
        break;
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
        routes.submitCla(req, res);
        break;
      case "GET /contributions/sync":
        routes.syncPullRequests(req, res);
        break;
      case "GET /contributions":
        routes.listPullRequests(req, res);
        break;
      case "GET /contributions/pr":
        routes.getPullRequestDetail(req, res);
        break;
      case "GET /contributions/reset":
        routes.resetContributionData(req, res);
        break;
      default:
        routes.default(req, res);
    }
  })
  .listen(port, () => {
    console.log(
      "Server is running at:",
      `\n   Local: http://localhost:${port}`,
      `\n   Public: ${getWebsiteAddress()}`
    );
    console.log("Listening for webhook events at:",
      `\n   Local webhook url: ${localWebhookUrl}`,
      `\n   Public webhook url: ${publicWebhookUrl}`);
    console.log("Press Ctrl + C to quit.");
  });

export { server };
