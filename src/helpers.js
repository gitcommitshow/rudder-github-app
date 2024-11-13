import { storage } from "./storage.js";
import { resolve } from "path";
import { PROJECT_ROOT_PATH } from "./config.js";
import url from "node:url";

export function parseUrlQueryParams(urlString) {
  if(!urlString) return urlString;
  try{
    const parsedUrl = url.parse(urlString)
    const query = parsedUrl.query;
    const params = new URLSearchParams(query);
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
  if (!isExternalContributionMaybe(pullRequest)) {
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
  if (!isExternalContributionMaybe(pullRequest)) {
    console.log(
      "This PR is an internal contribution. So no message after merge required.",
    );
    return false;
  }
  return true;
}

/**
 * Whether a pull request is a contribution by external user who has bot been associated with the repo
 * @param {Object} pullRequest 
 * @returns {boolean | undefined} - boolean when confirmed, undefined when not confirmed
 */
export function isExternalContributionMaybe(pullRequest) {
  const { owner, repo } = parseRepoUrl(pullRequest?.repository_url || pullRequest?.base?.repo?.html_url) || {};
  const username = pullRequest?.user?.login;
  if (typeof pullRequest?.author_association === "string") {
    // OWNER: Author is the owner of the repository.
    // MEMBER: Author is a member of the organization that owns the repository.
    // COLLABORATOR: Author has been invited to collaborate on the repository.
    // CONTRIBUTOR: Author has previously committed to the repository.
    // FIRST_TIMER: Author has not previously committed to GitHub.
    // FIRST_TIME_CONTRIBUTOR: Author has not previously committed to the repository.
    // MANNEQUIN: Author is a placeholder for an unclaimed user.
    // NONE: Author has no association with the repository (or doesn't want to make his association public).
    switch (pullRequest.author_association.toUpperCase()) {
      case "OWNER":
        pullRequest.isExternalContribution = false;
        storage.cache.set(false, username, "contribution", "external", owner, repo);
        return false;
      case "MEMBER":
        pullRequest.isExternalContribution = false;
        storage.cache.set(false, username, "contribution", "external", owner, repo);
        return false;
      case "COLLABORATOR":
        pullRequest.isExternalContribution = false;
        storage.cache.set(false, username, "contribution", "external", owner, repo);
        return false;
      default:
        //Will need more checks to verify author relation with the repo
        break;
    }
  }
  if (pullRequest?.head?.repo?.full_name !== pullRequest?.base?.repo?.full_name) {
    pullRequest.isExternalContribution = true;
    storage.cache.set(true, username, "contribution", "external", owner, repo);
    return true;
  } else if (pullRequest?.head?.repo?.full_name && pullRequest?.base?.repo?.full_name) {
    pullRequest.isExternalContribution = false;
    storage.cache.set(false, username, "contribution", "external", owner, repo);
    return false;
  }
  // Utilize cache if possible
  const isConfirmedToBeExternalContributionInPast = storage.cache.get(username, "contribution", "external", owner, repo);
  if (typeof isConfirmedToBeExternalContributionInPast === "boolean") {
    pullRequest.isExternalContribution = isConfirmedToBeExternalContributionInPast;
    return isConfirmedToBeExternalContributionInPast
  }
  // Ambigous results after this point.
  // Cannot confirm whether an external contribution or not.
  // Need more reliable check.
  return undefined;
}

async function isExternalContribution(octokit, pullRequest) {
  const probablisticResult = isExternalContributionMaybe(pullRequest);
  if (typeof probablisticResult === "boolean") {
    // Boolean is returned when the probabilistic check is sufficient
    return probablisticResult;
  }
  const username = pullRequest?.user?.login;
  const { owner, repo } = parseRepoUrl(pullRequest?.repository_url || pullRequest?.base?.repo?.html_url) || {};
  //TODO: Handle failure in checking permissions for the user
  const deterministicPermissionCheck = await isAllowedToWriteToTheRepo(octokit, username, owner, repo);
  pullRequest.isExternalContribution = deterministicPermissionCheck;
  storage.cache.set(deterministicPermissionCheck, username, "contribution", "external", owner, repo);
  return deterministicPermissionCheck;
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
 * await afterCLA(app, claSignatureInfo);
 */
export async function afterCLA(app, claSignatureInfo) {
  const { org, username } = parseUrlQueryParams(claSignatureInfo?.referrer) || {};
  const githubUsername = claSignatureInfo.username || username;
  
  if (!org || !githubUsername || !app) {
    console.log("Not enough info to find the related PRs.");
    return;
  }

  console.log(`Processing CLA for ${githubUsername ? `user: ${githubUsername}` : 'unknown user'} in org/account: ${org}`);
  let failuresToRemoveLabel = 0; // To track the failures in removing labels
  try {
    //TODO: Check if the Octokit instance is already authenticated with an installation ID
    const octokit = await getOctokitForOrg(app, org);
    // Query to find all open PRs created by githubUsername in all org repositories
    const query = `org:${org} is:pr is:open author:${githubUsername}`;
    // GitHub Docs for octokit.rest.search - https://github.com/octokit/plugin-rest-endpoint-methods.js/tree/main/docs/search
    const { data: { items: prs } } = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      sort: "updated",
      order: "desc"
    });

    const filteredPrs = prs?.filter(pr => pr?.user?.login === githubUsername);
    console.log(`Found ${filteredPrs?.length} open PRs for ${githubUsername} in ${org}:`, filteredPrs?.map(pr => pr?.number).join(', '));
    for (const pr of filteredPrs) {
      const { owner, repo } = parseRepoUrl(pr?.repository_url) || {};
      const hasPendingCLALabel = pr.labels?.some(label => label?.name?.toLowerCase() === "pending cla");
      console.log(`PR #${pr?.number} has "Pending CLA" label: ${hasPendingCLALabel}`);
      if (hasPendingCLALabel) {
        try {
          await removePendingCLALabel(octokit, owner, repo, pr?.number);
        } catch (err) {
          failuresToRemoveLabel++;
        }
      } else {
        console.log(`PR #${pr?.number} in ${owner}/${repo} does not have "Pending CLA" label. Skipping.`);
      }
      //TODO: Add comment in PR: Thank you @contributor for signing the CLA. @reviewers, you may go ahead with the review now.
      //      Only if(filteredPrs.length<5) to avoid too many comments
    }
  } catch (error) {
    if (error?.status === 403 && error?.message?.includes('rate limit')) {
      console.error("Rate limit exceeded. Please try again later.");
    } else {
      console.error("Error in afterCLA:", error);
    }
    throw new Error("Error in post CLA verification tasks such as removing Pending CLA labels")
  }
  if (failuresToRemoveLabel > 0) {
    throw new Error("Failure to remove labels in some repos")
  }
  console.log("Completed post CLA verification tasks successfully");
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
    } else if (labelError.status === 403) {
      console.log(`Not permitted to remove label in ${owner}/${repo}.`);
      console.error(`Please install the GitHub app in ${owner}/${repo}.`);
    } else {
      console.error(`Error removing label from PR #${issue_number}:`, labelError.message);
    }
    throw new Error("Error in removing 'Pending CLA' label")
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
  if (!username) return
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

/**
 * Authenticate as app installation for the org
 * Authenticating as an app installation lets your app access resources that are owned by the user or organization
 * that installed the app. Authenticating as an app installation is ideal for automation workflows
 * that don't involve user input.
 * Check out { @link https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app GitHub Docs for Authentication }
 *  and { @tutorial https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation GitHub Docs for Authenticating App Installation}
 * @param {Object} app 
 * @param {string} org 
 * @returns 
 */
export async function getOctokitForOrg(app, org) {
  // Find the installation for the organization
  for await (const { installation } of app.eachInstallation.iterator()) {
    if (installation.account.login.toLowerCase() === org.toLowerCase()) {
      // Create an authenticated client for this installation
      const octokit = await app.getInstallationOctokit(installation.id);
      return octokit
    }
  }
  console.error("No GitHub App installation found for " + org);
  // Fall back authentication method
  const DEFAULT_GITHUB_ORG = process.env.DEFAULT_GITHUB_ORG;
  if (DEFAULT_GITHUB_ORG && org !== DEFAULT_GITHUB_ORG) {
    return await getOctokitForOrg(app, DEFAULT_GITHUB_ORG);
  }
}

export async function verifyGitHubAppAuthenticationAndAccess(app) {
  console.log("Verifying GitHub App authentication and access...");

  try {
    // Verify app installation
    for await (const { installation } of app.eachInstallation.iterator()) {
      console.log(`\nChecking installation for ${installation.account.login} (${installation.account.type}):`);

      // Create an authenticated client for this installation
      const octokit = await app.getInstallationOctokit(installation.id);

      // List repositories the app can access in this installation
      const repos = await octokit.rest.apps.listReposAccessibleToInstallation();
      console.log(`- Has access to ${repos.data.repositories.length} repositories:`);
      repos.data.repositories.forEach(repo => {
        console.log(`  - ${repo.full_name}`);
      });

      // List the permissions the app has for this installation
      console.log("- App permissions:");
      Object.entries(installation.permissions).forEach(([key, value]) => {
        console.log(`  - ${key}: ${value}`);
      });
    }
    console.log("\nAuthentication and access verification completed successfully.");
  } catch (error) {
    console.error("Error during authentication and access verification:", error);
    if (error.status === 401) {
      console.error("Authentication failed. Please check your app credentials (appId and privateKey).");
    } else if (error.status === 403) {
      console.error("Authorization failed. The app might not have the required permissions.");
    } else {
      console.error("An unexpected error occurred:", error.message);
    }
  }
}

/**
 * Parses a repository URL to extract the owner and repository name.
 * Supports HTTPS, Git protocol URLs, and API urls
 * @param {string} repoUrl - The repository URL.
 * @returns {object|null} - An object with owner and repo, or null if parsing fails.
 */
function parseRepoUrl(repoUrl) {
  try {
    const url = new URL(repoUrl);

    // Extract pathname and split into segments
    // e.g. https://api.github.com/repos/Git-Commit-Show/gcs-cli
    const pathname = url.pathname.replace(/\.git$/, ''); // Remove .git suffix if present
    const segments = pathname.split('/').filter(segment => segment.length > 0);

    if (segments.length < 2) {
      return null; // Not enough segments to determine owner and repo
    }

    return { owner: segments[segments.length - 2], repo: segments[segments.length - 1] };
  } catch (error) {
    //TODO: Handle cases where URL constructor fails (e.g., SSH URLs)
    return null;
  }
}

export async function getOpenPullRequests(octokit, owner, repo, options) {
  let query = `is:pr is:open` + (repo ? ` repo:${owner + "/" + repo}` : ` org:${owner}`);
  const BOT_USERS = process.env.GITHUB_BOT_USERS ? process.env.GITHUB_BOT_USERS.split(",")?.map((item) => item?.trim()) : null;
  const GITHUB_ORG_MEMBERS = process.env.GITHUB_ORG_MEMBERS ? process.env.GITHUB_ORG_MEMBERS.split(",")?.map((item) => item?.trim()) : null;
  // Remove results from bots or internal team members
  BOT_USERS?.forEach((botUser) => query += (" -author:" + botUser));
  GITHUB_ORG_MEMBERS?.forEach((orgMember) => query += (" -author:" + orgMember));
  const response = await octokit.rest.search.issuesAndPullRequests({
    q: query,
    per_page: 100,
    page: options?.page || 1,
    sort: 'created',
    order: 'desc'
  });
  console.log(response?.data?.total_count + " results found for search: " + query);
  const humanPRs = response?.data?.items?.filter(pr => pr.user && pr.user.type === 'User');
  return humanPRs;
}

export async function getOpenExternalPullRequests(app, owner, repo, options) {
  try {
    const octokit = await getOctokitForOrg(app, owner);
    if (!octokit) {
      throw new Error("Failed to search PR because of undefined octokit intance")
    }
    const openPRs = await getOpenPullRequests(octokit, owner, repo, options);
    if (!Array.isArray(openPRs)) {
      return;
    }
    // Send only the external PRs
    const openExternalPRs = []
    for (const pr of openPRs) {
      try {
        pr.isExternalContribution = await isExternalContribution(octokit, pr);
        if (pr.isExternalContribution) {
          openExternalPRs.push(pr);
        }
      } catch (err) {
        // Some error occurred, so we cannot deterministically say whether it is an external contribution or not
        pr.isExternalContribution = undefined;
        // We are anyways going to send this in the external open PR list
        openExternalPRs.push(pr);
      }
    }
    return openExternalPRs
  } catch (err) {
    return
  }
}

export function timeAgo(date) {
  if (!date) return '';
  if (typeof date === 'string') {
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

/**
 * Check user permissions for a repository
 * The authenticating octokit instance must have "Metadata" repository permissions (read)
 * @param {string} username 
 * @param {string} owner 
 * @param {string} repo 
 * @returns {boolean}
 */
async function isAllowedToWriteToTheRepo(octokit, username, owner, repo,) {
  try {
    const result = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username,
    });
    if (["admin", "write"].includes(result?.permission)) {
      return true
    }
    if (["admin", "maintain", "write"].includes(result?.role_name)) {
      return true
    }
    return false;
  } catch (err) {
    // If 403 error "HttpError: Resource not accessible by integration"
    // The app is not installed in that repo
    // Only "metadata:repository" permission is needed for this api, which all gh apps have wherever they are installed
    console.log("Failed to check if a " + username + " is allowed to write to " + owner + "/" + repo);
    // console.error(err);
    throw new Error("Failed to check user permission for the repo")
  }
}

export async function getPullRequestDetail(app, owner, repo, number) {
  const octokit = await getOctokitForOrg(app, owner);
  if (!octokit) {
    throw new Error("Failed to search PR because of undefined octokit intance")
  }
  const { data } = await octokit.rest.pulls.get({
    owner: owner,
    repo: repo,
    pull_number: number
  });
  if (!data) return data;
  const pr = Object.assign({}, data, { isExternalContribution: isExternalContributionMaybe(data) });
  return pr;
}