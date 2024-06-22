import fs from "fs";
import { resolve } from "path";

import { PROJECT_ROOT_PATH } from "./helpers.js";

const dbPath = process.env.DB_PATH || resolve(PROJECT_ROOT_PATH, "db.json");

export const storage = {
  save(data) {
    const currentData = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    currentData.push(data);
    fs.writeFileSync(dbPath, JSON.stringify(currentData, null, 2));
  },
  get(filters) {
    const currentData = JSON.parse(fs.readFileSync(dbPath, "utf8"));
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
