import { storage } from "./storage.js";
import { resolve } from "path";
import { PROJECT_ROOT_PATH } from "./config.js";
import url from "node:url";
import GitHub from "./services/GitHub.js";

export function isOneCLAPerOrgEnough() {
  return process.env.ONE_CLA_PER_ORG?.toLowerCase()?.trim() === "true"
    ? true
    : false;
}

export function parseUrlQueryParams(urlString) {
  if (!urlString) return urlString;
  try {
    const parsedUrl = url.parse(urlString);
    const query = parsedUrl.query;
    const params = new URLSearchParams(query);
    return Object.fromEntries(params.entries());
  } catch (err) {
    console.error(err);
    return;
  }
}

export function queryStringToJson(str) {
  if (!str) {
    return {};
  }
  // Remove any leading ? from query string
  str = str.replace(/^\?/, "");
  try {
    // Use built-in URLSearchParams to safely parse query string
    const params = new URLSearchParams(str);
    const result = {};
    // Convert URLSearchParams to plain object
    for (const [key, value] of params) {
      result[decodeURIComponent(key)] = decodeURIComponent(value);
    }
    return result;
  } catch (err) {
    console.error("Failed to parse query string:", err);
    return {};
  }
}

export function isCLARequired(pullRequest) {
  if (isABot(pullRequest.user)) {
    console.log("This PR is from a bot. So no CLA required.");
    return false;
  }
  if (!GitHub.isExternalContributionMaybe(pullRequest, isOneCLAPerOrgEnough(), storage.cache)) {
    console.log("This PR is an internal contribution. So no CLA required.");
    return false;
  }
  if (isCLASigned(pullRequest.user.login)) {
    console.log("Author signed CLA already. So no CLA required.");
    return false;
  }
  return true;
}

export function isMessageAfterMergeRequired(pullRequest) {
  if (isABot(pullRequest?.user)) {
    console.log("This PR is from a bot. So no message after merge required.");
    return false;
  }
  if (!GitHub.isExternalContributionMaybe(pullRequest, isOneCLAPerOrgEnough(), storage.cache)) {
    console.log(
      "This PR is an internal contribution. So no message after merge required.",
    );
    return false;
  }
  return true;
}

export function isABot(user) {
  if (user?.type === "Bot") {
    return true;
  }
  return false;
}

export async function isOrgMember(octokit, org, username) {
  // Check if the is a member of the organization
  try {
    // Docs for octokit.rest.orgs.checkMembershipForUser - https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs/orgs/checkMembershipForUser.md
    await octokit.rest.orgs.checkMembershipForUser({
      org,
      username,
    });
    return true;
  } catch (err) {
    console.log(err);
    return false;
  }
}

/**
 * This function is used to remove the "Pending CLA" label from the PRs of the user who has signed the CLA.
 * @param {Object} app - The Octokit app instance.
 * @param {Object} claSignatureInfo - The information about the CLA signature.
 * @example
 * const claSignatureInfo = {
 *   referrer: "https://website.com/cla?org=rudderlabs&repo=rudder-server&prNumber=1234&username=githubUsername", // The URL of the page where the CLA was signed
 *   username: "githubUsername" // The username of the user who signed the CLA,
 * }
 * await afterCLA(claSignatureInfo);
 */
export async function afterCLA(claSignatureInfo) {
  const { org, username } =
    parseUrlQueryParams(claSignatureInfo?.referrer) || {};
  const githubUsername = claSignatureInfo.username || username;

  if (!org || !githubUsername || !GitHub.app) {
    console.log("Not enough info to find the related PRs.");
    return;
  }

  console.log(
    `Processing CLA for ${githubUsername ? `user: ${githubUsername}` : "unknown user"} in org/account: ${org}`,
  );
  let failuresToRemoveLabel = 0; // To track the failures in removing labels
  try {
    //TODO: Check if the Octokit instance is already authenticated with an installation ID
    const octokit = await GitHub.getOctokitForOrg(org);
    // Query to find all open PRs created by githubUsername in all org repositories
    const query = `org:${org} is:pr is:open author:${githubUsername}`;
    // GitHub Docs for octokit.rest.search - https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs/search
    const {
      data: { items: prs },
    } = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      sort: "updated",
      order: "desc",
    });

    const filteredPrs = prs?.filter((pr) => pr?.user?.login === githubUsername);
    console.log(
      `Found ${filteredPrs?.length} open PRs for ${githubUsername} in ${org}:`,
      filteredPrs?.map((pr) => pr?.number).join(", "),
    );
    for (const pr of filteredPrs) {
      const { owner, repo } = GitHub.parseRepoUrl(pr?.repository_url) || {};
      const hasPendingCLALabel = pr.labels?.some(
        (label) => label?.name?.toLowerCase() === "pending cla",
      );
      console.log(
        `PR #${pr?.number} has "Pending CLA" label: ${hasPendingCLALabel}`,
      );
      if (hasPendingCLALabel) {
        try {
          await removePendingCLALabel(octokit, owner, repo, pr?.number);
        } catch (err) {
          failuresToRemoveLabel++;
        }
      } else {
        console.log(
          `PR #${pr?.number} in ${owner}/${repo} does not have "Pending CLA" label. Skipping.`,
        );
      }
      //TODO: Add comment in PR: Thank you @contributor for signing the CLA. @reviewers, you may go ahead with the review now.
      //      Only if(filteredPrs.length<5) to avoid too many comments
    }
  } catch (error) {
    if (error?.status === 403 && error?.message?.includes("rate limit")) {
      console.error("Rate limit exceeded. Please try again later.");
    } else {
      console.error("Error in afterCLA:", error);
    }
    throw new Error(
      "Error in post CLA verification tasks such as removing Pending CLA labels",
    );
  }
  if (failuresToRemoveLabel > 0) {
    throw new Error("Failure to remove labels in some repos");
  }
  console.log("Completed post CLA verification tasks successfully");
}

async function removePendingCLALabel(octokit, owner, repo, issue_number) {
  try {
    console.log(
      `Removing label 'Pending CLA' from PR #${issue_number} in ${owner}/${repo}`,
    );
    // Docs for octokit.rest.issues.removeLabel - https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs/issues/removeLabel.md
    await octokit.rest.issues.removeLabel({
      owner,
      repo,
      issue_number,
      name: "Pending CLA",
    });
    console.log(
      `Label 'Pending CLA' removed successfully from PR #${issue_number}.`,
    );
  } catch (labelError) {
    if (labelError.status === 404) {
      console.log(
        `Label 'Pending CLA' not found on PR #${issue_number}. Skipping.`,
      );
    } else if (labelError.status === 403) {
      console.log(`Not permitted to remove label in ${owner}/${repo}.`);
      console.error(`Please install the GitHub app in ${owner}/${repo}.`);
    } else {
      console.error(
        `Error removing label from PR #${issue_number}:`,
        labelError.message,
      );
    }
    throw new Error("Error in removing 'Pending CLA' label");
  }
}

/**
 * This function is used to get the message string based on the name of the message template and the context.
 * @param {string} name - The name of the message template.
 * @param {Object} context - The context object containing variables for the message template.
 * @returns {string} - The message string.
 * @example
 * const context = {
 *   org: "rudderlabs",
 *   repo: "rudder-server",
 *   pr_number: 1234,
 *   username: "githubUsername"
 * }
 * const message = getMessage("ask-to-sign-cla", context);
 */
export function getMessage(name, context) {
  let message = "";
  switch (name) {
    case "ask-to-sign-cla":
      const CLA_LINK =
        getWebsiteAddress() +
        "/cla" +
        `?org=${context.org}&repo=${context.repo}&prNumber=${context.pr_number}&username=${context.username}`;
      message = `Thank you @${context.username} for contributing this PR.
      Please [sign the Contributor License Agreement (CLA)](${CLA_LINK}) before merging.`;
      break;
    case "message-after-merge":
      message = `Thank you @${context.username} for contributing this PR.`;
      if (
        context.org === "rudderlabs" &&
        context.repo === "rudder-transformer"
      ) {
        message += `For every new integration, a PR needs to be raised in [integartions-config](https://github.com/rudderlabs/rudder-integrations-config) repository as well.
        Without it, users won't be able to configure the integration.
        This is a good time to do that.`;
      }
      if (
        context.org === "rudderlabs" &&
        context.repo === "integrations-config"
      ) {
        message += `To get notified when this integration goes live, join the **product-releases** channel in the [Slack Community](https://www.rudderstack.com/join-rudderstack-slack-community/)`;
      }
      break;
    default:
      const filepath = resolve(PROJECT_ROOT_PATH, name + ".md");
      message = fs.readFileSync(filepath, "utf8");
  }
  return message;
}

export function isCLASigned(username) {
  if (!username) return;
  const userData = storage.get({ username: username, terms: "on" });
  if (userData?.length > 0) {
    return true;
  }
  return false;
}

export function jsonToCSV(arr) {
  if (!arr || arr.length === 0) return "";
  // const headers = Object.keys(arr[0]);
  const headers = [
    "terms",
    "legalName",
    "username",
    "email",
    "ip",
    "referrer",
    "serverTimestamp",
  ];
  const csvRows = [];
  // Add headers
  csvRows.push(headers.join(","));
  // Add rows
  for (const row of arr) {
    const values = headers.map((header) => {
      const value = row[header];
      // Handle nested objects, arrays, undefined and null values
      let escaped;
      if (value === undefined || value === null) {
        escaped = ""; // Convert undefined/null to empty string
      } else if (typeof value === "object") {
        escaped = JSON.stringify(value).replace(/"/g, '""');
      } else {
        escaped = String(value).replace(/"/g, '""');
      }
      return `"${escaped}"`;
    });
    csvRows.push(values.join(","));
  }
  return csvRows.join("\n");
}



export function timeAgo(date) {
  if (!date) return "";
  if (typeof date === "string") {
    date = new Date(date);
  }
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  let interval = Math.floor(seconds / 31536000);

  if (interval > 1) {
    return `${interval} years ago`;
  }
  interval = Math.floor(seconds / 2592000);
  if (interval > 1) {
    return `${interval} months ago`;
  }
  interval = Math.floor(seconds / 604800);
  if (interval > 1) {
    return `${interval} weeks ago`;
  }
  interval = Math.floor(seconds / 86400);
  if (interval > 1) {
    return `${interval} days ago`;
  }
  interval = Math.floor(seconds / 3600);
  if (interval > 1) {
    return `${interval} hours ago`;
  }
  interval = Math.floor(seconds / 60);
  if (interval > 1) {
    return `${interval} minutes ago`;
  }
  return `${seconds} seconds ago`;
}

export function getWebsiteAddress() {
  // 1: WEBSITE_ADDRESS if set by the dev
  if (process.env.WEBSITE_ADDRESS) {
    return process.env.WEBSITE_ADDRESS;
  }
  const port = process.env.PORT || 3000;
  // 2: Construct url for the staging server on CodeSandbox
  if (process.env.CODESANDBOX_HOST) {
    return `https://${process.env.HOSTNAME}-${port}.csb.app`;
  }
  if (process.env.NODE_ENV === 'production'){
    console.error("Admin Notice: WEBSITE_ADDRESS is not set in env. This will break CLA functionality.");
    return "WEBSITE_ADDRESS_NOT_SET: Contact admin";
  }
  // 3: Last resort: localhost
  return `http://localhost:${port}`;
}