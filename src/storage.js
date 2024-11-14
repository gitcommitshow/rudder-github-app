import fs from "fs";
import { resolve } from "path";
import { PROJECT_ROOT_PATH } from "./config.js";

const dbPath = process.env.DB_PATH || resolve(PROJECT_ROOT_PATH, "db.json");
const cachePath = process.env.CACHE_PATH || resolve(PROJECT_ROOT_PATH, "cache.json");
createFileIfMissing(dbPath);
createFileIfMissing(cachePath);
const CACHE = initCache();
let lastSnapshotTime = new Date().getTime();
let cacheSnapshotSize = CACHE.size;
const CACHE_SNAPSHOT_INTERVAL = 1000 * 60 * 5;

function initCache() {
  try {
    const json = fs.readFileSync(cachePath, 'utf-8'); // Read the file as a string
    const obj = JSON.parse(json); // Parse JSON back to an object
    return new Map(Object.entries(obj)); // Convert Object to a Map
  } catch (err) {
    return new Map();
  }
}

async function lazyCacheSnapshot() {
  try {
    const currentTime = new Date().getTime();
    if ((currentTime - lastSnapshotTime) < CACHE_SNAPSHOT_INTERVAL || CACHE.size === cacheSnapshotSize) {
      return;
    }
    const obj = Object.fromEntries(CACHE); // Convert Map to an Object
    const json = JSON.stringify(obj, null, 2); // Convert Object to JSON
    fs.writeFile(cachePath, json, 'utf-8', function (err) {
      if (!err) {
        cacheSnapshotSize = CACHE.size;
        console.log("Cache saved to file successfully. Total entries: " + cacheSnapshotSize);
      } else {
        console.error("Unexpected error in saving cache to file. Could be permission related issue.");
      }
    }); // Write JSON to a file
    lastSnapshotTime = currentTime;
    console.log(`Cache saved to ${cachePath}`);
  } catch (err) {
    console.error("Error in saving cache to file");
  }
}

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
  cache: {
    get: function (...args) {
      const key = args.join("/");
      return CACHE.get(key);
    },
    set: function (value, ...args) {
      const key = args.join("/");
      let cache = CACHE.set(key, value);
      lazyCacheSnapshot();
      return cache
    }
  }
};
