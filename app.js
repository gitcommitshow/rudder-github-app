import dotenv from "dotenv";
import fs from "fs";
import http from "http";
import url from "url";
import { Octokit, App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import { routes } from "./src/routes.js";
import { getMessage, isCLARequired } from "./src/helpers.js";

// Load environment variables from .env file
dotenv.config();

// Set configured values
const appId = process.env.APP_ID;
// To add GitHub App Private Key directly as a string config (instead of file), convert it to base64 by running following command
// openssl base64 -in /path/to/original-private-key.pem -out ./base64EncodedKey.txt -A
// Then set GITHUB_APP_PRIVATE_KEY_BASE64 environment variable with the value of ./base64EncodedKey.txt content
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY_BASE64
  ? Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString(
      "utf8",
    )
  : null;
const privateKey =
  GITHUB_APP_PRIVATE_KEY ||
  fs.readFileSync(
    process.env.PRIVATE_KEY_PATH || "./GITHUB_APP_PRIVATE_KEY.pem",
    "utf8",
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

// Optional: Get & log the authenticated app's name
const { data } = await app.octokit.request("/app");

// Read more about custom logging: https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${data.name}'`);

// Subscribe to the "pull_request.opened" webhook event
app.webhooks.on("pull_request.opened", async ({ octokit, payload }) => {
  console.log(
    `Received a pull request event for #${payload.pull_request.number}`,
  );
  try {
    if (!isCLARequired(payload.pull_request)) {
      return;
    }
    // If the user is not a member of the organization and haven't yet signed CLA,
    //  ask them to sign the CLA
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.pull_request.number,
      body: getMessage("ask-to-sign-cla", {
        username: payload.pull_request.user.login,
        org: payload.repository.owner.login,
        repo: payload.repository.name,
        pr_number: payload.pull_request.number,
      }),
    });
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
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`,
      );
    } else {
      console.error(error);
    }
  }
});

app.webhooks.on("issues.opened", async ({ octokit, payload }) => {
  console.log(
    `Received a new issue event for #${payload.issue.number} by ${pull_request.user.type}: ${pull_request.user.login}`,
  );
  try {
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: "Thanks for opening this issue! We'll get back to you shortly. If it is a bug, please make sure to add steps to reproduce the issue.",
    });
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`,
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
const path = "/api/webhook";
const localWebhookUrl = `http://localhost:${port}${path}`;

// See https://github.com/octokit/webhooks.js/#createnodemiddleware for all options
const middleware = createNodeMiddleware(app.webhooks, { path });

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
      case "POST /cla":
        routes.submitCla(req, res, app);
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
      "Server is also serving the homepage at: http://localhost:" + port,
    );
    console.log("Press Ctrl + C to quit.");
  });
