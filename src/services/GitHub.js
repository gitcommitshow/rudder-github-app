/**
 * GitHub App and API service
 * Resusable utility functions, not the business logic
 */

import { Octokit, App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";

class GitHub {

  constructor(){
    this.app = null;
    // The constructor gets executed on import because of immediate execution of export new GitHub()
    // So, do not include any task that needs to wait for some things to be done (e.g. configuration for GitHub App)
  }

  /**
   * Authenticate an instance of GitHub App which can be used to access GitHub APIs and webhooks
   * @param {string} appId - The ID of the GitHub App
   * @param {string} privateKey 
   * @param {string} webhookSecret 
   * @param {string} enterpriseHostname - The hostname of the enterprise instance e.g. enterprise.github.com
   * @param {string} enterpriseHostname 
   * @returns {App} - The authenticated GitHub App instance
   * @example
   * GitHub.authenticateApp(appId, privateKey, secret, enterpriseHostname);
   * GitHub.app.webhooks.on("pull_request.opened", async ({ octokit, payload }) => {
   *   console.log(payload);
   * });
   */
  authenticateApp(appId, privateKey, webhookSecret, enterpriseHostname){
    if(this.app){
      return this.app;
    }
    this.app = new App({
      appId,
      privateKey,
      webhooks: {
        secret: webhookSecret,
      },
      ...(enterpriseHostname && {
        Octokit: Octokit.defaults({
          baseUrl: `https://${enterpriseHostname}/api/v3`,
        }),
      }),
    });
    return this.app;
  }

  /**
   * Get the authenticated app's info
   * @returns {Promise<Object>} - The authenticated app's info
   */
  async getAppInfo(){
    const { data } = await this.app.octokit.request("/app");
    return data;
  }

  /**
   * Get the GitHub App middleware
   * @param {string} webhookPath - The path to the webhook e.g. /api/webhook
   * @returns {Function} - The GitHub App middleware
   * @example 
   * const githubWebhookRequestHandler = GitHub.getWebhookRequestHandler("/api/webhook");
   * http.createServer((req, res) => {
   *   githubWebhookRequestHandler(req, res);
   * });
   */
  getWebhookRequestHandler(webhookPath){
    return createNodeMiddleware(this.app.webhooks, { path: webhookPath });
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
  async getOctokitForOrg(org) {
    if(typeof org !== "string") {
      throw new Error("Unexpected org type passed to getOctokitForOrg: " + typeof org);
    }
    if (!this.app) {
      throw new Error("GitHub App is not iniitalized or authenticated");
    }
    // Find the installation for the organization
    for await (const { installation } of this.app?.eachInstallation?.iterator()) {
      if (installation.account.login.toLowerCase() === org?.toLowerCase()) {
        // Create an authenticated client for this installation
        const octokit = await this.app.getInstallationOctokit(installation.id);
        return octokit;
      }
    }
    console.error("No GitHub App installation found for " + org);
    // Fall back authentication method
    const DEFAULT_GITHUB_ORG = process.env.DEFAULT_GITHUB_ORG;
    if (DEFAULT_GITHUB_ORG && org !== DEFAULT_GITHUB_ORG) {
      return await this.getOctokitForOrg(DEFAULT_GITHUB_ORG);
    }
  }

  /**
   * Verify GitHub App authentication and access
   * @returns {Promise<void>}
   */
  async verifyGitHubAppAuthenticationAndAccess() {
    if (!this.app) {
      throw new Error("GitHub App is not iniitalized or authenticated");
    }
    console.log("Verifying GitHub App authentication and access...");

    try {
      // Verify app installation
      for await (const { installation } of this.app.eachInstallation.iterator()) {
        console.log(
          `\nChecking installation for ${installation.account.login} (${installation.account.type}):`,
        );

        // Create an authenticated client for this installation
        const octokit = await this.app.getInstallationOctokit(installation.id);

        // List repositories the app can access in this installation
        const repos = await octokit.rest.apps.listReposAccessibleToInstallation();
        console.log(
          `- Has access to ${repos.data.repositories.length} repositories:`,
        );
        repos.data.repositories.forEach((repo) => {
          console.log(`  - ${repo.full_name}`);
        });

        // List the permissions the app has for this installation
        console.log("- App permissions:");
        Object.entries(installation.permissions).forEach(([key, value]) => {
          console.log(`  - ${key}: ${value}`);
        });
      }
      console.log(
        "\nAuthentication and access verification completed successfully.",
      );
    } catch (error) {
      console.error(
        "Error during authentication and access verification:",
        error,
      );
      if (error.status === 401) {
        console.error(
          "Authentication failed. Please check your app credentials (appId and privateKey).",
        );
      } else if (error.status === 403) {
        console.error(
          "Authorization failed. The app might not have the required permissions.",
        );
      } else {
        console.error("An unexpected error occurred:", error.message);
      }
    }
  }

  /**
   * Get external pull requests
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - Options
   * @param {Object} cache - Cache object with get/set methods
   * @returns {Promise<Array>} - Array of pull requests
   */
  async getExternalPullRequests(owner, repo, options, cache) {
    try {
      const octokit = await this.getOctokitForOrg(owner);
      if (!octokit) {
        throw new Error(
          "Failed to search PR because of undefined octokit intance",
        );
      }
      const allPRs = await this.getPullRequests(octokit, owner, repo, options);
      if (!Array.isArray(allPRs)) {
        return;
      }
      // Send only the external PRs
      const externalPRs = [];
      for (const pr of allPRs) {
        try {
          pr.isExternalContribution = await this.isExternalContribution(octokit, pr, options.isOneCLAPerOrgEnough, cache);
          if (pr.isExternalContribution) {
            externalPRs.push(pr);
          }
        } catch (err) {
          // Some error occurred, so we cannot deterministically say whether it is an external contribution or not
          pr.isExternalContribution = undefined;
          // We are anyways going to send this in the external PR list
          externalPRs.push(pr);
        }
      }
      return externalPRs;
    } catch (err) {
      return;
    }
  }

  /**
   * Get open external pull requests
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - Options
   * @param {Object} cache - Cache object with get/set methods
   * @returns {Promise<Array>} - Array of pull requests
   */
  async getOpenExternalPullRequests(owner, repo, options, cache) {
    try {
      const octokit = await this.getOctokitForOrg(owner);
      if (!octokit) {
        throw new Error(
          "Failed to search PR because of undefined octokit intance",
        );
      }
      const openPRs = await this.getOpenPullRequests(octokit, owner, repo, options);
      if (!Array.isArray(openPRs)) {
        return;
      }
      // Send only the external PRs
      const openExternalPRs = [];
      for (const pr of openPRs) {
        try {
          pr.isExternalContribution = await this.isExternalContribution(octokit, pr, options.isOneCLAPerOrgEnough, cache);
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
      return openExternalPRs;
    } catch (err) {
      return;
    }
  }


  /**
   * Get pull request detail
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} number - Pull request number
   * @param {Object} options - Options
   * @param {boolean} options.isOneCLAPerOrgEnough - Whether one CLA per org is enough
   * @param {Object} cache - Cache object with get/set methods
   * @returns {Promise<Object>} - Pull request detail
   */
  async getPullRequestDetail(owner, repo, number, options, cache) {
    const octokit = await this.getOctokitForOrg(owner);
    if (!octokit) {
      throw new Error("Failed to search PR because of undefined octokit intance");
    }
    const { data } = await octokit.rest.pulls.get({
      owner: owner,
      repo: repo,
      pull_number: number,
    });
    if (!data) return data;
    const pr = Object.assign({}, data, {
      isExternalContribution: this.isExternalContributionMaybe(data, options.isOneCLAPerOrgEnough, cache),
    });
    return pr;
  }

  /**
   * Get PR changes including file paths and content
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} pullNumber - Pull request number
   * @returns {Promise<Object>} - Object containing files and changes
   * @example
   * const prChanges = await GitHub.getPRChanges('gitcommitshow', 'rudder-github-app', 82);
   * // Returns: {
   * //   title: "feat: notify on slack",
   * //   description: "Deployment instructions\r\n\r\nlorem ipsu",
   * //   diff: "https://github.com/gitcommitshow/rudder-github-app/pull/82.diff",
   * //   baseCommit: "ddcc8bc7ecb2fa2ce8f4bf36bdf25adbb0b36f38",
   * //   headCommit: "e14433e76d74dc680b8cf9102d39f31970e8b794",
   * //   files: [{
   * //     filename: ".codesandbox/tasks.json",
   * //     status: "modified",
   * //     additions: 2,
   * //     deletions: 2,
   * //     changes: 4,
   * //     patch: "@@ -11,15 +11,15 @@\n   \"tasks\": {\n     \"server\": {\n       \"name\": \"server\",\n-      \"command\": \"npm start\"\n+      \"command\": \"npm run staging\"\n     },\n     \"lint\": {\n       \"name\": \"lint\",\n       \"command\": \"npm run lint\"\n     },\n     \"n\": {\n       \"name\": \"n\",\n-      \"command\": \"npm start\",\n+      \"command\": \"npm run staging\",\n       \"runAtStart\": true,\n       \"preview\": {\n         \"port\": 3000",
   * //     content: "{\n  // These tasks will run in order when initializing your CodeSandbox project.\n  \"setupTasks\": [\n    {\n      \"name\": \"Install Dependencies\",\n      \"command\": \"npm install\"\n    }\n  ],\n\n  // These tasks can be run from CodeSandbox. Running one will open a log in the app.\n  \"tasks\": {\n    \"server\": {\n      \"name\": \"server\",\n      \"command\": \"npm run staging\"\n    },\n    \"lint\": {\n      \"name\": \"lint\",\n      \"command\": \"npm run lint\"\n    },\n    \"n\": {\n      \"name\": \"n\",\n      \"command\": \"npm run staging\",\n      \"runAtStart\": true,\n      \"preview\": {\n        \"port\": 3000\n      }\n    }\n  }\n}\n",
   * //     size: 594,
   * //     sha: "93d2e3ad586a8b838da82486bc1fe3dc620442a9",
   * //   }],
   * // }
   */
  async getPRChanges(owner, repo, pullNumber) {
    try {
      const octokit = await this.getOctokitForOrg(owner);
      if (!octokit) {
        throw new Error("Failed to get authenticated Octokit instance");
      }

      // Get PR files (this gives us the list of changed files)
      const { data: files } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
      });

      // Filter out test files and get content for production files
      const productionFiles = await this.filterAndGetFileContent(
        octokit,
        owner,
        repo,
        files,
        pullNumber,
      );

      // Get the diff for context
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });

      return {
        files: productionFiles,
        diff: pr.diff_url,
        baseCommit: pr.base.sha,
        headCommit: pr.head.sha,
        title: pr.title,
        description: pr.body,
      };
    } catch (error) {
      console.error("Error getting PR changes:", error);
      throw new Error(`Failed to get PR changes: ${error.message}`);
    }
  }


  /**
 * Whether a pull request is a contribution by external user who has bot been associated with the repo
 * @param {Object} pullRequest
 * @param {boolean} isOneCLAPerOrgEnough
 * @param {Object} cache - Cache object with get/set methods
 * @returns {boolean | undefined} - boolean when confirmed, undefined when not confirmed
 */
isExternalContributionMaybe(pullRequest, isOneCLAPerOrgEnough, cache) {
  const { owner, repo } =
    this.parseRepoUrl(
      pullRequest?.repository_url || pullRequest?.base?.repo?.html_url,
    ) || {};
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
        if (cache && cache.set) {
          cache.set(
            false,
            username,
            "contribution",
            "external",
            owner,
            isOneCLAPerOrgEnough ? undefined : repo,
          );
        }
        return false;
      case "MEMBER":
        pullRequest.isExternalContribution = false;
        if (cache && cache.set) {
          cache.set(
            false,
            username,
            "contribution",
            "external",
            owner,
            isOneCLAPerOrgEnough ? undefined : repo,
          );
        }
        return false;
      case "COLLABORATOR":
        pullRequest.isExternalContribution = false;
        if (cache && cache.set) {
          cache.set(
            false,
            username,
            "contribution",
            "external",
            owner,
            isOneCLAPerOrgEnough ? undefined : repo,
          );
        }
        return false;
      default:
        //Will need more checks to verify author relation with the repo
        break;
    }
  }
  if (
    pullRequest?.head?.repo?.full_name !== pullRequest?.base?.repo?.full_name
  ) {
    pullRequest.isExternalContribution = true;
    if (cache && cache.set) {
      cache.set(
        true,
        username,
        "contribution",
        "external",
        owner,
        isOneCLAPerOrgEnough ? undefined : repo,
      );
    }
    return true;
  } else if (
    pullRequest?.head?.repo?.full_name &&
    pullRequest?.base?.repo?.full_name
  ) {
    pullRequest.isExternalContribution = false;
    if (cache && cache.set) {
      cache.set(
        false,
        username,
        "contribution",
        "external",
        owner,
        isOneCLAPerOrgEnough ? undefined : repo,
      );
    }
    return false;
  }
  // Utilize cache if possible
  const isConfirmedToBeExternalContributionInPast = cache && cache.get ? cache.get(
    username,
    "contribution",
    "external",
    owner,
    isOneCLAPerOrgEnough ? undefined : repo,
  ) : undefined;
  if (typeof isConfirmedToBeExternalContributionInPast === "boolean") {
    pullRequest.isExternalContribution =
      isConfirmedToBeExternalContributionInPast;
    return isConfirmedToBeExternalContributionInPast;
  }
  // Ambigous results after this point.
  // Cannot confirm whether an external contribution or not.
  // Need more reliable check.
  return undefined;
}

/**
 * Whether a pull request is a contribution by external user who has not been associated with the repo
 * @param {Object} octokit - Authenticated Octokit instance
 * @param {Object} pullRequest - Pull request object
 * @param {boolean} isOneCLAPerOrgEnough
 * @param {Object} cache - Cache object with get/set methods
 * @returns {Promise<boolean | undefined>} - boolean when confirmed, undefined when not confirmed
 */
async isExternalContribution(octokit, pullRequest, isOneCLAPerOrgEnough, cache) {
  const probablisticResult = this.isExternalContributionMaybe(pullRequest, isOneCLAPerOrgEnough, cache);
  if (typeof probablisticResult === "boolean") {
    // Boolean is returned when the probabilistic check is sufficient
    return probablisticResult;
  }
  const username = pullRequest?.user?.login;
  const { owner, repo } =
    this.parseRepoUrl(
      pullRequest?.repository_url || pullRequest?.base?.repo?.html_url,
    ) || {};
  //TODO: Handle failure in checking permissions for the user
  const deterministicPermissionCheck = await this.isAllowedToWriteToTheRepo(
    octokit,
    username,
    owner,
    repo,
  );
  pullRequest.isExternalContribution = deterministicPermissionCheck;
  if (cache && cache.set) {
    cache.set(
      deterministicPermissionCheck,
      username,
      "contribution",
      "external",
      owner,
      isOneCLAPerOrgEnough ? undefined : repo,
    );
  }
  return deterministicPermissionCheck;
}

/**
 * Check user permissions for a repository
 * The authenticating octokit instance must have "Metadata" repository permissions (read)
 * @param {Object} octokit - Authenticated Octokit instance
 * @param {string} username
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<boolean>}
 */
async isAllowedToWriteToTheRepo(octokit, username, owner, repo) {
  try {
    const result = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username,
    });
    if (["admin", "write"].includes(result?.permission)) {
      return true;
    }
    if (["admin", "maintain", "write"].includes(result?.role_name)) {
      return true;
    }
    return false;
  } catch (err) {
    // If 403 error "HttpError: Resource not accessible by integration"
    // The app is not installed in that repo
    // Only "metadata:repository" permission is needed for this api, which all gh apps have wherever they are installed
    console.log(
      "Failed to check if " +
        username +
        " is allowed to write to " +
        owner +
        "/" +
        repo,
    );
    // console.error(err);
    throw new Error("Failed to check user permission for the repo");
  }
}

  /**
   * Filter files to exclude tests and get file content
   * @param {Object} octokit - Authenticated Octokit instance
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Array} files - List of changed files from PR
   * @param {number} pullNumber - Pull request number
   * @returns {Promise<Array>} - Array of production files with content
   */
  async filterAndGetFileContent(octokit, owner, repo, files, pullNumber) {
    const productionFiles = [];

    for (const file of files) {
      // Skip test files
      if (this.isTestFile(file.filename)) {
        console.log(`Skipping test file: ${file.filename}`);
        continue;
      }

      try {
        // Get file content from the head commit
        const { data: fileContent } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: file.filename,
          ref: `pull/${pullNumber}/head`,
        });

        productionFiles.push({
          filename: file.filename,
          status: file.status, // added, modified, removed, etc.
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch, // Unified diff format
          content: fileContent.content ?
            Buffer.from(fileContent.content, 'base64').toString('utf-8') : null,
          size: fileContent.size,
          sha: fileContent.sha,
        });
      } catch (error) {
        console.error(`Error getting content for file ${file.filename}:`, error);
        // If we can't get content, still include the file info
        productionFiles.push({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
          content: null,
          error: error.message,
        });
      }
    }

    return productionFiles;
  }

  /**
   * Check if a file is a test file
   * @param {string} filename - File path
   * @returns {boolean} - True if it's a test file
   */
  isTestFile(filename) {
    const testPatterns = [
      /test/i,
      /spec/i,
      /\.test\./i,
      /\.spec\./i,
      /__tests__/i,
      /\.test$/i,
      /\.spec$/i,
    ];

    return testPatterns.some(pattern => pattern.test(filename));
  }

  /**
   * Format changes for external API consumption
   * @param {Object} prChanges - PR changes object
   * @returns {Object} - Formatted data for external API
   */
  formatPRChangesData(prChanges) {
    return {
      title: prChanges.title,
      description: prChanges.description,
      files: prChanges.files.map(file => ({
        path: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        content: file.content,
        patch: file.patch,
      })),
      summary: {
        totalFiles: prChanges.files.length,
        totalAdditions: prChanges.files.reduce((sum, file) => sum + file.additions, 0),
        totalDeletions: prChanges.files.reduce((sum, file) => sum + file.deletions, 0),
      },
    };
  }

  /**
   * Get open pull requests
   * @param {Object} octokit - Authenticated Octokit instance
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - Options
   * @returns {Promise<Array>} - Array of pull requests
   */
  async getOpenPullRequests(octokit, owner, repo, options) {
    let query =
      `is:pr is:open` + (repo ? ` repo:${owner + "/" + repo}` : ` org:${owner}`);
    const BOT_USERS = process.env.GITHUB_BOT_USERS
      ? process.env.GITHUB_BOT_USERS.split(",")?.map((item) => item?.trim())
      : null;
    const GITHUB_ORG_MEMBERS = process.env.GITHUB_ORG_MEMBERS
      ? process.env.GITHUB_ORG_MEMBERS.split(",")?.map((item) => item?.trim())
      : null;
    if (options?.after && /^\d{4}-\d{2}-\d{2}$/.test(options.after)) {
      query += " created:>=" + options.after;
    }
    if (options?.before && /^\d{4}-\d{2}-\d{2}$/.test(options.before)) {
      query += " created:<=" + options.before;
    }
    if (typeof options?.merged === "boolean") {
      if (!options.merged) {
        query += " -is:merged";
      } else {
        query += " is:merged";
      }
    }
    // Remove results from bots or internal team members
    BOT_USERS?.forEach((botUser) => (query += " -author:" + botUser));
    GITHUB_ORG_MEMBERS?.forEach(
      (orgMember) => (query += " -author:" + orgMember),
    );
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: 100,
      page: options?.page || 1,
      sort: "created",
      order: "desc",
    });
    console.log(
      response?.data?.total_count + " results found for search: " + query,
    );
    const humanPRs = response?.data?.items?.filter(
      (pr) => pr.user && pr.user.type === "User",
    );
    return humanPRs;
  }

  /**
   * Get pull requests
   * @param {Object} octokit - Authenticated Octokit instance
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - Options
   * @returns {Promise<Array>} - Array of pull requests
   */
  async getPullRequests(octokit, owner, repo, options) {
    let query =
      `is:pr` + (repo ? ` repo:${owner + "/" + repo}` : ` org:${owner}`);
    if (options?.status) {
      query += " is:" + options.status;
    }
    if (options?.after && /^\d{4}-\d{2}-\d{2}$/.test(options.after)) {
      query += " created:>=" + options.after;
    }
    if (options?.before && /^\d{4}-\d{2}-\d{2}$/.test(options.before)) {
      query += " created:<=" + options.before;
    }
    if (typeof options?.merged === "boolean") {
      if (!options.merged) {
        query += " -is:merged";
      } else {
        query += " is:merged";
      }
    }
    const BOT_USERS = process.env.GITHUB_BOT_USERS
      ? process.env.GITHUB_BOT_USERS.split(",")?.map((item) => item?.trim())
      : null;
    const GITHUB_ORG_MEMBERS = process.env.GITHUB_ORG_MEMBERS
      ? process.env.GITHUB_ORG_MEMBERS.split(",")?.map((item) => item?.trim())
      : null;
    // Remove results from bots or internal team members
    BOT_USERS?.forEach((botUser) => (query += " -author:" + botUser));
    GITHUB_ORG_MEMBERS?.forEach(
      (orgMember) => (query += " -author:" + orgMember),
    );
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: 100,
      page: options?.page || 1,
      sort: "created",
      order: "desc",
    });
    console.log(
      response?.data?.total_count + " results found for search: " + query,
    );
    const humanPRs = response?.data?.items?.filter(
      (pr) => pr.user && pr.user.type === "User",
    );
    return humanPRs;
  }

/**
 * Parses a repository URL to extract the owner and repository name.
 * Supports HTTPS, Git protocol URLs, and API urls
 * @param {string} repoUrl - The repository URL.
 * @returns {object|null} - An object with owner and repo, or null if parsing fails.
 */
 parseRepoUrl(repoUrl) {
  try {
    const url = new URL(repoUrl);

    // Extract pathname and split into segments
    // e.g. https://api.github.com/repos/Git-Commit-Show/gcs-cli
    const pathname = url.pathname.replace(/\.git$/, ""); // Remove .git suffix if present
    const segments = pathname
      .split("/")
      .filter((segment) => segment.length > 0);

    if (segments.length < 2) {
      return null; // Not enough segments to determine owner and repo
    }

    return {
      owner: segments[segments.length - 2],
      repo: segments[segments.length - 1],
    };
  } catch (error) {
    //TODO: Handle cases where URL constructor fails (e.g., SSH URLs)
    return null;
  }
}

  /**
   * Add a comment to a GitHub issue or PR
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} issue_number - Issue number
   * @param {string} result - Comment body
   */
  async addCommentToIssueOrPR(owner, repo, issue_number, result) {
    if(!owner || !repo || !issue_number || !result) {
      throw new Error("Please add owner, repo, issue_number and result parameters in order to add a comment to a GitHub issue or PR");
    }
    const octokit = await this.getOctokitForOrg(owner);
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number,
      body: result,
    });
  }
}

export default new GitHub();