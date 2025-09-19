/**
 * GitHub App and API service
 * Resusable utility functions, not the business logic
 */

import { Octokit, App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";

class GitHub {

  constructor(){
    this.app = null;
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
    if (!this.app) {
      throw new Error("GitHub App is not iniitalized or authenticated");
    }
    // Find the installation for the organization
    for await (const { installation } of this.app?.eachInstallation?.iterator()) {
      if (installation.account.login.toLowerCase() === org.toLowerCase()) {
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
   * @returns {Promise<Array>} - Array of pull requests
   */
  async getExternalPullRequests(owner, repo, options) {
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
          pr.isExternalContribution = await this.isExternalContribution(octokit, pr);
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
   * @returns {Promise<Array>} - Array of pull requests
   */
  async getOpenExternalPullRequests(owner, repo, options) {
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
   * @returns {Promise<Object>} - Pull request detail
   */
  async getPullRequestDetail(owner, repo, number) {
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
      isExternalContribution: isExternalContributionMaybe(data),
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
        pullNumber
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
}

export default new GitHub();