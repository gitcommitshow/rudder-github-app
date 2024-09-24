import fs from "fs";
import { resolve } from "path";
import { PROJECT_ROOT_PATH } from "./config.js";

const dbPath = process.env.DB_PATH || resolve(PROJECT_ROOT_PATH, "db.json");
createFileIfMissing(dbPath);

function createFileIfMissing(path) {
  try {
    // Try to open the file in read-only mode
    const fd = fs.openSync(path, "r");
    fs.closeSync(fd);
    console.log("DB file exists at " + dbPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      // If the file does not exist, create it
      fs.writeFileSync(path, "[]", { flag: "wx" }); // 'wx' flag ensures the file is created and not overwritten if it exists
      console.log("DB file created at " + dbPath);
    } else {
      // Some other error occurred
      console.error(err);
      throw new Error("Failed to create the DB file at " + dbPath);
    }
  }
}

export const storage = {
  save(data) {
    createFileIfMissing(dbPath);
    const currentData = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    currentData.push(data);
    fs.writeFileSync(dbPath, JSON.stringify(currentData, null, 2));
  },
  get(filters) {
    const currentData = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    if (!filters) return currentData;
    return currentData.filter((item) => {
      for (const [key, value] of Object.entries(filters)) {
        if (item[key] !== value) {
          return false;
        }
      }
      return true;
    });
  },
};
