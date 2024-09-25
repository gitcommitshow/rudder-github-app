import { storage } from "./storage.js";
import { resolve } from "path";
import { PROJECT_ROOT_PATH } from "./config.js";

export function parseUrlQueryParams(urlString) {
  if(!urlString) return urlString;
  try{
    const url = new URL(urlString);
    const params = new URLSearchParams(url.search);
    return Object.fromEntries(params.entries());
  } catch(err){
    console.error(err);
    return
  }
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

/**
 * This function is used to remove the "Pending CLA" label from the PRs of the user who has signed the CLA.
 * @param {Object} app - The Octokit app instance.
 * @param {Object} claSignatureInfo - The information about the CLA signature.
 * @example
 * const claSignatureInfo = {
 *   referrer: "https://website.com/cla?org=rudderlabs&repo=rudder-server&prNumber=1234&username=githubUsername", // The URL of the page where the CLA was signed
 *   username: "githubUsername" // The username of the user who signed the CLA,
 * }
 * await afterCLA(app, claSignatureInfo);
 */
export async function afterCLA(app, claSignatureInfo) {
  const { org, username } = parseUrlQueryParams(claSignatureInfo?.referrer) || {};
  const githubUsername = claSignatureInfo.username || username;
  
  if (!org || !githubUsername) {
    console.log("Not enough info to find the related PRs.");
    return;
  }

  console.log(`Processing CLA for ${githubUsername ? `user: ${githubUsername}` : 'unknown user'} in org/account: ${org}`);
  
  try {
    const query = `org:${org} is:pr is:open author:${githubUsername}`;
    // GitHub Docs for octokit.rest.search - https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs/search
    const { data: { items: prs } } = await app.octokit.rest.search.issuesAndPullRequests({
      q: query,
      sort: "updated",
      order: "desc"
    });

    const filteredPrs = prs.filter(pr => pr.user.login === githubUsername);
    console.log(`Found ${filteredPrs.length} open PRs for ${githubUsername} in ${org}:`, filteredPrs.map(pr => pr.number).join(', '));

    for await (const { installation } of app.eachInstallation.iterator()) {
      for await (const { octokit, repository } of app.eachRepository.iterator({
        installationId: installation.id,
      })) {
        console.log(`Processing repository: ${repository.name}`);
        
        // Check if the current repository belongs to the org
        if (repository?.owner?.login?.toLowerCase() !== org?.toLowerCase()) {
          console.log(`Skipping ${repository.name} as it doesn't belong to ${org}`);
          continue;
        }

        // Process PRs for the current repository
        for (const pr of filteredPrs) {
          if (pr.repository?.name === repository.name) {
            const hasPendingCLALabel = pr.labels?.some(label => label?.name?.toLowerCase() === "pending cla");
            console.log(`PR #${pr.number} has "Pending CLA" label: ${hasPendingCLALabel}`);
            if (hasPendingCLALabel) {
              await removePendingCLALabel(octokit, org, repository.name, pr.number);
            } else {
              console.log(`PR #${pr.number} in ${org}/${repository.name} does not have "Pending CLA" label. Skipping.`);
            }
          }
        }
      }
    }
  } catch (error) {
    if (error?.status === 403 && error?.message?.includes('rate limit')) {
      console.error("Rate limit exceeded. Please try again later.");
    } else {
      console.error("Error in afterCLA:", error);
    }
  } finally {
    console.log("Completed post CLA verification tasks");
  }
}

async function removePendingCLALabel(octokit, owner, repo, issue_number) {
  try {
    console.log(`Removing label 'Pending CLA' from PR #${issue_number} in ${owner}/${repo}`);
    // Docs for octokit.rest.issues.removeLabel - https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs/issues/removeLabel.md
    await octokit.rest.issues.removeLabel({
      owner,
      repo,
      issue_number,
      name: "Pending CLA",
    });
    console.log(`Label 'Pending CLA' removed successfully from PR #${issue_number}.`);
  } catch (labelError) {
    if (labelError.status === 404) {
      console.log(`Label 'Pending CLA' not found on PR #${issue_number}. Skipping.`);
    } else {
      console.error(`Error removing label from PR #${issue_number}:`, labelError.message);
    }
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
        process.env.WEBSITE_ADDRESS +
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