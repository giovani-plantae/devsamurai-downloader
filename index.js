import path from "path";
import { fileURLToPath } from "url";
import Downloader from "./src/downloader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://class.devsamurai.com.br/";
const OUTPUT_DIR = path.join(__dirname, "output");

const args = process.argv.slice(2);
let maxConcurrent = 5;
let retryFailed = 0;

for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg.startsWith("--parallel=")) {
        const value = Number.parseInt(arg.split("=", 2)[1] ?? "", 10);
        if (Number.isInteger(value) && value > 0) {
            maxConcurrent = value;
        }
        continue;
    }

    if (arg === "--parallel" || arg === "-p") {
        const next = args[i + 1];
        const value = Number.parseInt(next ?? "", 10);
        if (Number.isInteger(value) && value > 0) {
            maxConcurrent = value;
            i += 1;
        }
        continue;
    }

    if (arg.startsWith("--retry-failed=")) {
        const valueRaw = arg.split("=", 2)[1] ?? "";
        const value = Number.parseInt(valueRaw, 10);
        retryFailed = Number.isInteger(value) && value > 0 ? value : 1;
        continue;
    }

    if (arg === "--retry-failed" || arg === "-r") {
        const next = args[i + 1];
        const value = Number.parseInt(next ?? "", 10);
        if (Number.isInteger(value) && value > 0) {
            retryFailed = value;
            i += 1;
        } else {
            retryFailed = 1;
        }
        continue;
    }

    const positionalValue = Number.parseInt(arg, 10);
    if (Number.isInteger(positionalValue) && positionalValue > 0) {
        maxConcurrent = positionalValue;
    }
}

const downloader = new Downloader(BASE_URL, OUTPUT_DIR, maxConcurrent, retryFailed);

(async () => {
    const ready = await downloader.initialize();
    if (!ready) {
        return;
    }
    await downloader.start();
})();
