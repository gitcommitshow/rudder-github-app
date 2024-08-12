import fs from "fs";
import { storage } from "./storage.js";
import {
  PROJECT_ROOT_PATH,
  afterCLA,
  queryStringToJson,
  parseUrlQueryParams,
} from "./helpers.js";
import { resolve } from "path";
import { jsonToCSV } from "./helpers.js";
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
      let bodyJson = queryStringToJson(body);
      const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
      bodyJson.ip = ip;
      if (!bodyJson.referrer && req.headers["referer"]) {
        bodyJson.referrer = req.headers["referer"];
      }
      const serverTimestamp = new Date().toISOString();
      bodyJson.serverTimestamp = serverTimestamp;
      storage.save(bodyJson);
      await afterCLA(app, bodyJson);
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

  default(req, res) {
    res.writeHead(404);
    res.write("Path not found!");
    return res.end();
  },
};
