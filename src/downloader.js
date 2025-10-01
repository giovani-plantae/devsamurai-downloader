import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import pLimit from "p-limit";
import FileDownloadTask from "./file-download-task.js";
import ProgressRenderer from "./progress-renderer.js";

export default class Downloader {
    constructor(baseUrl, outputDir, maxConcurrent = 5) {
        this.baseUrl = baseUrl;
        this.outputDir = outputDir;
        this.maxConcurrent = maxConcurrent;
        this.tasks = [];
        this.progressRenderer = new ProgressRenderer();
    }

    async initialize() {
        await fs.ensureDir(this.outputDir);
        const links = await this.fetchDownloadLinks();

        this.tasks = links.map((url) => {
            const fileName = decodeURIComponent(path.basename(url));
            const destPath = path.join(this.outputDir, fileName);
            return new FileDownloadTask(url, destPath);
        });

        // Prepare tasks (detect .zip/.part and get total sizes)
        const limit = pLimit(this.maxConcurrent);
        await Promise.all(
            this.tasks.map((t) => limit(() => t.prepare()))
        );
    }

    async fetchDownloadLinks() {
        const response = await axios.get(this.baseUrl);
        const $ = cheerio.load(response.data);
        const links = [];

        $("a").each((_, element) => {
            const href = $(element).attr("href");
            if (href && href.toLowerCase().endsWith(".zip")) {
                try {
                    const absolute = new URL(href, this.baseUrl).toString();
                    links.push(absolute);
                } catch {
                    // ignore malformed URLs
                }
            }
        });

        // De-duplicate and keep stable order by filename
        const seen = new Set();
        const uniq = links.filter((u) => {
            if (seen.has(u)) return false;
            seen.add(u);
            return true;
        });
        uniq.sort((a, b) => decodeURIComponent(path.basename(a)).localeCompare(decodeURIComponent(path.basename(b))));
        return uniq;
    }

    async start() {
        const limit = pLimit(this.maxConcurrent);
        this.progressRenderer.track(this.tasks);
        this.progressRenderer.start();

        const runnable = this.tasks.filter((t) => t.status !== "completed");

        const results = await Promise.allSettled(
            runnable.map((task) =>
                limit(async () => {
                    try {
                        await task.run(() => this.progressRenderer.onProgress(task));
                        this.progressRenderer.onComplete(task);
                    } catch (err) {
                        this.progressRenderer.onError(task, err);
                    }
                })
            )
        );

        this.progressRenderer.stop();

        // Throw if any failed (to signal non-zero exit if desired)
        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
            const err = new Error(`${failures.length} downloads falharam`);
            err.failures = failures;
            throw err;
        }
    }
}
