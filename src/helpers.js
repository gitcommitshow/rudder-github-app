import { storage } from "./storage.js";
import { resolve, dirname } from "path";
import url from "url";

const __currentDir = dirname(url.fileURLToPath(import.meta.url)); // Path to directory of this file
export const PROJECT_ROOT_PATH = resolve(__currentDir, ".."); // Assuming this file is located one folder under root

export function parseUrlQueryParams(urlString) {
  const url = new URL(urlString);
  const params = new URLSearchParams(url.search);
  return Object.fromEntries(params.entries());
}

export function queryStringToJson(str) {
  if (!str) {
    return {};
  }
  return str.split("&").reduce((result, item) => {
    const parts = item.split("=");
    const key = decodeURIComponent(parts[0]);
    const value = parts.length > 1 ? decodeURIComponent(parts[1]) : "";
    result[key] = value;
    return result;
  }, {});
}

export function isCLARequired(pullRequest) {
  if (isABot(pullRequest.user)) {
    console.log("This PR is from a bot. So no CLA required.");
    return false;
  }
  if (!isExternalContribution(pullRequest)) {
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
  if (!isExternalContribution(pullRequest)) {
    console.log(
      "This PR is an internal contribution. So no message after merge required.",
    );
    return false;
  }
  return true;
}

export function isExternalContribution(pullRequest) {
  if (
    pullRequest?.head?.repo?.full_name !== pullRequest?.base?.repo?.full_name
  ) {
    return true;
  }
  return false;
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

export async function getOctokitForRepo(app, owner, repo) {
  for await (const { installation } of app.eachInstallation.iterator()) {
    for await (const { octokit, repository } of app.eachRepository.iterator({
      installationId: installation.id,
    })) {
      if (repository.owner.login === owner && repository.name === repo) {
        return octokit;
      }
    }
  }
  throw new Error(`Installation not found for repository ${owner}/${repo}`);
}

export async function afterCLA(app, claSignatureInfo) {
  if (!claSignatureInfo || !claSignatureInfo.referrer) return;
  const { org, repo, prNumber } = parseUrlQueryParams(
    claSignatureInfo.referrer,
  );
  console.log(
    `PR related to the CLA - owner: ${org}, repo: ${repo}, prNumber: ${prNumber}`,
  );
  if (!org || !repo || !prNumber) {
    console.log("Not enough info to find the related PR.");
    return;
  }
  try {
    let octokit = await getOctokitForRepo(app, org, repo);
    await octokit.rest.issues.removeLabel({
      owner: org,
      repo: repo,
      issue_number: prNumber,
      name: "Pending CLA",
    });
    console.log("Label 'Pending CLA' removed successfully.");
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`,
      );
    } else {
      console.error(error);
    }
  } finally {
    console.log("Completed post CLA verification tasks");
  }
}

export function getMessage(name, context) {
  let message = "";
  switch (name) {
    case "ask-to-sign-cla":
      const CLA_LINK =
        process.env.WEBSITE_ADDRESS +
        "/cla" +
        `?org=${context.org}&repo=${context.repo}&prNumber=${context.pr_number}&username=${context.username}`;
      message = `Thank you for contributing this PR.
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
  const userData = storage.get({ username: username, terms: "on" });
  if (userData?.length > 0) {
    return true;
  }
  return false;
}

export function jsonToCSV(arr) {
  if (!arr || arr.length === 0) return '';

  const headers = Object.keys(arr[0]);
  const csvRows = [];

  // Add headers
  csvRows.push(headers.join(','));

  // Add rows
  for (const row of arr) {
    const values = headers.map(header => {
      const value = row[header];
      // Handle nested objects and arrays
      const escaped = typeof value === 'object' && value !== null 
        ? JSON.stringify(value).replace(/"/g, '""')
        : String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}