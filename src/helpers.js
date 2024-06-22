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

export function getMessage(name, payload) {
  let message = "";
  switch (name) {
    case "ask-to-sign-cla":
      const CLA_LINK =
        process.env.WEBSITE_ADDRESS +
        "/cla" +
        `?org=${payload.org}&repo=${payload.repo}&prNumber=${payload.pr_number}&username=${payload.username}`;
      message = `Thank you for contributing this PR.
      Please [sign the Contributor License Agreement (CLA)](${CLA_LINK}) before merging.`;
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
