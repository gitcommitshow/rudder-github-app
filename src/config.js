import { resolve, dirname } from "path";
import url from "url";

const __currentDir = dirname(url.fileURLToPath(import.meta.url)); // Path to directory of this file
export const PROJECT_ROOT_PATH = resolve(__currentDir, ".."); // Assuming this file is located one folder under root
