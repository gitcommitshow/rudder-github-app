import fs from "fs";
import { storage } from "./storage.js";
import {
  PROJECT_ROOT_PATH,
  afterCLA,
  queryStringToJson,
  parseUrlQueryParams,
} from "./helpers.js";
import { resolve } from "path";

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

  submitCla(req, res, octokit) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString(); // convert Buffer to string
    });

    req.on("end", async () => {
      let bodyJson = queryStringToJson(body);
      const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
      bodyJson.ip = ip;
      if (!bodyJson.referrer && req.headers["referer"]) {
        bodyJson.referrer = req.headers["referer"];
      }
      const serverTimestamp = new Date().toISOString();
      bodyJson.serverTimestamp = serverTimestamp;
      storage.save(bodyJson);
      await afterCLA(octokit, bodyJson);
      // Referrer has information about which PR this CLA flow started from
      const { org, repo, prNumber } = parseUrlQueryParams(bodyJson.referrer);
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
        "<h1>CLA Signed successfully ☑️</h1>\n<pre>" +
          JSON.stringify(bodyJson, null, 2) +
          "</pre>",
      );
      return res.end();
    });
  },

  default(req, res) {
    res.writeHead(404);
    res.write("Path not found!");
    return res.end();
  },
};
