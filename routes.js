import fs from "fs";
import { storage } from "./storage.js";
import { queryStringToJson } from "./helpers.js";

export const routes = {
  home(req, res) {
    fs.readFile("./home.html", function (err, data) {
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

  form(req, res) {
    fs.readFile("./form.html", function (err, data) {
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

  submitForm(req, res) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString(); // convert Buffer to string
    });

    req.on("end", () => {
      console.log(body);
      let bodyJson = queryStringToJson(body);
      const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
      bodyJson.ip = ip;
      const serverTimestamp = new Date().toISOString();
      bodyJson.serverTimestamp = serverTimestamp;
      storage.save(bodyJson);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.write(
        "<h1>Form data saved ☑️</h1>\n<pre>" +
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
