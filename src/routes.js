import fs from "fs";
import { resolve } from "path";

import { PROJECT_ROOT_PATH } from "./config.js";
import { storage } from "./storage.js";
import { sanitizeInput } from "./sanitize.js";
import {
  afterCLA,
  queryStringToJson,
  parseUrlQueryParams,
  jsonToCSV,
  getOpenExternalPullRequests,
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
    const { org, repo } = parseUrlQueryParams(req.url) || {};
    if (!org) {
      res.writeHead(400);
      return res.end("Please add org parameter in the url e.g. ?org=my-github-org-name");
    }
    const prList = await getOpenExternalPullRequests(app, org, repo);
    res.setHeader('Content-Type', 'application/json');
    const jsonString = prList ? JSON.stringify(prList, null, 2) : ("No Open Pull Requests found (or you don't have access to search PRs for " + org);
    return res.end(jsonString);
  },

  default(req, res) {
    res.writeHead(404);
    res.write("Path not found!");
    return res.end();
  },
};
