import fs from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const dbPath = resolve(dirname(fileURLToPath(import.meta.url)), "db.json");

export const storage = {
  save(data) {
    const currentData = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    currentData.push(data);
    fs.writeFileSync(dbPath, JSON.stringify(currentData, null, 2));
  },
};
