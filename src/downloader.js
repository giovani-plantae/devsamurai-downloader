import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import pLimit from "p-limit";
import FileDownloadTask from "./file-download-task.js";
import ProgressRenderer from "./progress-renderer.js";

export default class Downloader {
    constructor(baseUrl, outputDir, maxConcurrent = 5, retryFailed = 0) {
        this.baseUrl = baseUrl;
        this.outputDir = outputDir;
        this.maxConcurrent = maxConcurrent;
        this.retryFailed = Math.max(0, retryFailed);
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
        const executeBatch = async (tasks) => {
            const limit = pLimit(this.maxConcurrent);
            await Promise.all(
                tasks.map((task) =>
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
        };

        this.progressRenderer.track(this.tasks);
        this.progressRenderer.resetViewport();
        this.progressRenderer.start();

        let attempts = 0;
        let pending = this.tasks.filter((t) => t.status !== "completed");

        while (pending.length > 0) {
            await executeBatch(pending);

            const failedNow = pending.filter((task) => task.status === "failed");
            if (failedNow.length === 0) {
                break;
            }

            if (attempts >= this.retryFailed) {
                break;
            }

            attempts += 1;

            failedNow.forEach((task) => {
                task.status = "queued";
                task.error = null;
            });

            pending = failedNow;
        }

        this.progressRenderer.stop();

        const stillFailed = this.tasks.filter((task) => task.status === "failed");
        if (stillFailed.length > 0) {
            const err = new Error(`${stillFailed.length} downloads falharam`);
            err.failures = stillFailed.map((task) => task.fileName);
            throw err;
        }
    }
}
