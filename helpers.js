export function queryStringToJson(rawData) {
  return rawData.split("&").reduce((result, item) => {
    const parts = item.split("=");
    result[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
    return result;
  }, {});
}

export async function isOrgMember(octokit, org, username) {
  // Check if the user is a member of the organization
  return await octokit.orgs.checkMembership({
    org,
    username,
  });
}
