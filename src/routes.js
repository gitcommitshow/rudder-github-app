import fs from "fs";
import { resolve } from "path";

import { PROJECT_ROOT_PATH } from "./config.js";
import { storage } from "./storage.js";
import { sanitizeInput } from "./sanitize.js";
import {
  isCLASigned,
  afterCLA,
  queryStringToJson,
  parseUrlQueryParams,
  jsonToCSV,
  getOpenExternalPullRequests,
  getPullRequestDetail,
  timeAgo
} from "./helpers.js";
import { isPasswordValid } from "./auth.js";

export const routes = {
  home(req, res) {
    const htmlPath = resolve(PROJECT_ROOT_PATH, "views", "home.html");
    fs.readFile(htmlPath, function (err, data) {
      if (err) {
        console.error(err);
        res.writeHead(404);
        res.write("Errors: File not found");
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.write(data);
      return res.end();
    });
  },

  cla(req, res) {
    const htmlPath = resolve(PROJECT_ROOT_PATH, "views", "cla.html");
    fs.readFile(htmlPath, function (err, data) {
      if (err) {
        res.writeHead(404);
        res.write("Errors: File not found");
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.write(data);
      return res.end();
    });
  },

  submitCla(req, res, app) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString(); // convert Buffer to string
    });

    req.on("end", async () => {
      let { terms, username, email, referrer } = queryStringToJson(body) || {};
      const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
      if (!referrer && req.headers["referer"]) {
        referrer = req.headers["referer"];
      }
      const serverTimestamp = new Date().toISOString();
      username = sanitizeInput(username);
      email = sanitizeInput(email);
      if (!terms || terms !== "on" || !username) {
        res.writeHead(302, {
          Location: referrer || "/cla",
        });
        return res.end();
      }
      try {
        storage.save({ terms, username, email, ip, referrer, serverTimestamp });
      } catch (err) {
        console.error("Failed to save CLA sign information");
        res.writeHead(302, {
          Location: referrer || "/cla",
        });
        return res.end();
      }
      try {
        await afterCLA(app, { terms, username, email, ip, referrer, serverTimestamp });
      } catch (err) {
        //TODO: Ask contributor to inform PR reviewers that the CLA has been signed
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.write(
          "<h3>CLA signed. But we were unable to update the PR status.</h3><br/>\
            We failed to remove 'Pending CLA' label automatically from your PRs.<br/><br/>\
            <strong>Next steps:</strong><br/>\
            1. Please make sure you submitted the correct information<br/>\
              <ul>\
                <li>Your GitHub Username: <strong>"+ username + "</strong></li>\
                <li>Your Email: <strong>"+ email + "</strong></li>\
              </ul>\
            2. Please ask PR reviewers to manually verify your CLA submission.< br /><br/><br/>\
          Note: Only one CLA submission is required, irrespective of number of PRs you raised.\
          "
        );
        return res.end();
      }
      // Referrer has information about which PR this CLA flow started from
      const { org, repo, prNumber } = parseUrlQueryParams(referrer) || {};
      if (org && repo && prNumber) {
        // Redirect To PR
        const prLink = `https://github.com/${org}/${repo}/pull/${prNumber}`;
        res.writeHead(302, {
          Location: prLink,
        });
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.write(
        "<h3>CLA Signed</h3><br/>\
          <strong>Next steps:</strong><br/>\
          1. Please make sure you submitted the correct information<br/>\
            <ul>\
              <li>Your GitHub Username: <strong>"+ username + "</strong></li>\
              <li>Your Email: <strong>"+ email + "</strong></li>\
            </ul>\
          2. Please contact PR Reviewers to verify your CLA submission.<br/><br/><br/>\
          Note: Only one CLA submission is required, irrespective of number of PRs you raised.\
        "
      );
      return res.end();
    });
  },

  downloadCenter(req, res) {
    const htmlPath = resolve(PROJECT_ROOT_PATH, "views", "download.html");
    fs.readFile(htmlPath, function (err, data) {
      if (err) {
        res.writeHead(404);
        res.write("Errors: File not found");
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.write(data);
      return res.end();
    });
  },

  download(req, res){
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString(); // convert Buffer to string
    });

    req.on("end", async () => {
      let bodyJson = queryStringToJson(body);
      if(!bodyJson || !bodyJson['username'] || !bodyJson['password'] || !isPasswordValid(bodyJson['username'], bodyJson['password'])){
        res.writeHead(404);
        res.write("Not Authorized");
        return res.end();
      }
      const jsonData = storage.get();
      const format = bodyJson['format'];
      if(format && format==='json'){
        // Set headers for JSON file download
        res.setHeader('Content-Disposition', 'attachment; filename=data.json');
        res.setHeader('Content-Type', 'application/json');
        // Convert JavaScript object to JSON string and send
        const jsonString = JSON.stringify(jsonData, null, 2);
        return res.end(jsonString);
      }
      // Send as csv format by default
      // Set headers for CSV file download
      res.setHeader('Content-Disposition', 'attachment; filename=data.csv');
      res.setHeader('Content-Type', 'text/csv');
      // Convert JavaScript object to CSV and send
      const csvString = jsonToCSV(jsonData);
      return res.end(csvString);
    })
  },

  syncPullRequests(req, res, app) {
    if (err) {
      res.writeHead(404);
      res.write("Not implemented yet");
      return res.end();
    }
    res.writeHead(302, {
      Location: "/pr",
    });
    return res.end();
  },

  async listPullRequests(req, res, app) {
    const { org, repo, page } = parseUrlQueryParams(req.url) || {};
    if (!org) {
      res.writeHead(400);
      return res.end("Please add org parameter in the url e.g. ?org=my-github-org-name");
    }
    const prs = await getOpenExternalPullRequests(app, org, repo, { page: page });
    if (req.headers['content-type']?.toLowerCase() === 'application/json') {
      res.setHeader('Content-Type', 'application/json');
      const jsonString = prs ? JSON.stringify(prs, null, 2) : ("No Open Pull Requests found (or you don't have access to search PRs for " + org);
      return res.end(jsonString);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write(`<!DOCTYPE html>
                <html>
                <head>
                  <title>Recent Contributions (Open)</title>
                  <style>
                        .tabs { margin-bottom: 20px; }
                        .tab-button { cursor: pointer; padding: 10px; margin-right: 5px; background-color: #ccc; border: none; }
                        .tab-button.active { background-color: #999; }
                        .tab-content { display: none; }
                        .tab-content.active { display: block; }
                    </style>
                  </head>
                  <body>
                      <h1>Recent Contributions (Open)</h1>
                      <div class="tabs">
                          ${Array.isArray(prs) && prs.length > 0 ? `<button id="btn-group-byUser" class="tab-button" onclick="switchView('byUser')">Group by User</button><button id="btn-group-byRepo" class="tab-button" onclick="switchView('byRepo')">Group by Repository</button>` : ""}
                      </div>
                      <div id="byUser" class="tab-content">
                          ${groupPullRequestsByUser(prs)}
                      </div>
                      <div id="byRepo" class="tab-content">
                          ${groupPullRequestsByRepo(prs)}
                      </div>
                      <br/><br/>
                      <div class="pagination">
                          <button class="pagination-button" onclick="goToNextPage()">Next Page...</button>
                      </div>
                  </body>
                  <script>
                      function switchView(viewId) {
                          document.querySelectorAll('.tab-content').forEach(tab => {
                              tab.classList.remove('active');
                          });
                          document.querySelectorAll('.tab-button').forEach(button => {
                              button.classList.remove('active');
                          });
                          document.getElementById(viewId).classList.add('active');
                          document.getElementById("btn-group-"+viewId).classList.add('active');
                      }
                      function goToNextPage() {
                            const currentUrl = new URL(window.location.href);
                            const currentPage = parseInt(currentUrl.searchParams.get('page')) || 1;
                            currentUrl.searchParams.set('page', currentPage + 1);
                            window.location.href = currentUrl.toString();
                      }
                      // Set default view
                      switchView('byUser');
                  </script>
                  </html>`);
    res.end();
  },
  async getPullRequestDetail(req, res, app) {
    const { org, repo, number } = parseUrlQueryParams(req.url) || {};
    if (!org) {
      res.writeHead(400);
      return res.end("Please add org parameter in the url e.g. ?org=my-github-org-name");
    }
    const pr = await getPullRequestDetail(app, org, repo, number);
    if (req.headers['content-type']?.toLowerCase() === 'application/json') {
      res.setHeader('Content-Type', 'application/json');
      const jsonString = pr ? JSON.stringify(pr, null, 2) : ("No Pull Requests found (or you don't have access to get this PR " + org + "/" + repo + "/" + number);
      return res.end(jsonString);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
                <html>
                <head>
                  <title>Pull Request Detail</title>
                  <style>
                        .tabs { margin-bottom: 20px; }
                        .tab-button { cursor: pointer; padding: 10px; margin-right: 5px; background-color: #ccc; border: none; }
                        .tab-button.active { background-color: #999; }
                        .tab-content { display: none; }
                        .tab-content.active { display: block; }
                    </style>
                  </head>
                  <body>
                      <h1>Pull Request Details</h1>
                      <code>
                        <pre>
                          ${JSON.stringify(pr, null, 2)}
                        </pre>
                      </code>
                      <br/><br/>
                  </body>
                  <script>
                      
                  </script>
                  </html>`);
  },
  // ${!Array.isArray(prs) || prs?.length < 1 ? "No contributions found! (Might be an access issue)" : prs?.map(pr => `<li><a href="${pr?.user?.html_url}">${pr?.user?.login}</a> contributed a PR - <a href="${pr?.html_url}" target="_blank">${pr?.title}</a> [${pr?.labels?.map(label => label?.name).join('] [')}]  <small>updated ${timeAgo(pr?.updated_at)}</small></li>`).join('')}
  default(req, res) {
    res.writeHead(404);
    res.write("Path not found!");
    return res.end();
  },
};



function groupPullRequestsByUser(prs) {
  if (!Array.isArray(prs) || prs?.length < 1) {
    return "No recent contributions found"
  }
  const grouped = prs?.reduce((acc, pr) => {
    if (!acc[pr?.user?.login]) {
      acc[pr?.user?.login] = [];
    }
    acc[pr?.user?.login].push(pr);
    return acc;
  }, {});
  let html = '';
  for (const user in grouped) {
    html += `<h2>${user} ${isCLASigned(user) ? "✅" : ""}</h2><ul>`;
    grouped[user].forEach(pr => {
      const repo = pr?.repository_url;
      const repoName = repo.split('/').slice(-1)[0];
      const org = repo.split('/').slice(-2)[0];
      const prLabels = pr?.labels?.length > 0 ? "[" + pr?.labels?.map(label => label?.name).join('] [') + "]" : "";
      html += `
          <li>
              <a href="${pr?.html_url}" target="_blank">${pr?.title}</a>
              ${prLabels}
              <small> updated ${timeAgo(pr?.updated_at)}</small>
              <a href="/contributions/detail?org=${org}&repo=${repoName}&number=${pr?.number}" target="_blank"><button>Get Details</button></a>
              <small>${typeof pr.isExternalContribution === "boolean" ? "" : " (Click to confirm author association) "}</small>
          </li>`;
    });
    html += '</ul>';
  }
  return html;
}

function groupPullRequestsByRepo(prs) {
  if (!Array.isArray(prs) || prs?.length < 1) {
    return "No recent contributions found"
  }
  const grouped = prs?.reduce((acc, pr) => {
    if (!acc[pr?.repository_url]) {
      acc[pr?.repository_url] = [];
    }
    acc[pr?.repository_url].push(pr);
    return acc;
  }, {});
  let html = '';
  for (const repo in grouped) {
    const repoName = repo.split('/').slice(-1)[0];
    const org = repo.split('/').slice(-2)[0];
    html += `<h2>${repoName}</h2><ul>`;
    grouped[repo].forEach(pr => {
      const prLabels = pr?.labels?.length > 0 ? "[" + pr?.labels?.map(label => label?.name).join('] [') + "]" : "";
      html += `
        <li>
            <a href="${pr?.html_url}" target="_blank">${pr?.title}</a>
            by <a target="_blank" href="${pr?.user?.html_url}">${pr?.user?.login} ${isCLASigned(pr?.user?.login) ? "✅" : ""}</a>
            ${prLabels}
            <small> updated ${timeAgo(pr?.updated_at)}</small>
            <a href="/contributions/detail?org=${org}&repo=${repoName}&number=${pr?.number}" target="_blank"><button>Get Details</button></a>
            <small>${typeof pr.isExternalContribution === "boolean" ? "" : " (Click to confirm author association) "}</small>
        </li>`;
    });
    html += '</ul>';
  }
  return html;
}