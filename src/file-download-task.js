import axios from "axios";
import fs from "fs-extra";
import path from "path";

export default class FileDownloadTask {
    constructor(url, destinationPath) {
        this.url = url;
        this.destinationPath = destinationPath;
        this.tempPath = `${destinationPath}.part`;
        this.downloadedBytes = 0;
        this.totalBytes = 0;
        this.status = "queued"; // queued | running | completed | failed
        this.error = null;
    }

    async prepare() {
        // Check local files first (completed or partial)
        if (await fs.pathExists(this.destinationPath)) {
            const stats = await fs.stat(this.destinationPath);
            this.downloadedBytes = stats.size;
            this.totalBytes = stats.size;
            this.status = "completed";
            // Clean any leftover .part if a full file already exists
            if (await fs.pathExists(this.tempPath)) {
                try { await fs.remove(this.tempPath); } catch {}
            }
            return;
        }

        if (await fs.pathExists(this.tempPath)) {
            const stats = await fs.stat(this.tempPath);
            this.downloadedBytes = stats.size;
        }

        // Try to get total size via HEAD to compute % before start
        try {
            const head = await axios.head(this.url, { timeout: 10000 });
            const len = parseInt(head.headers["content-length"] ?? "0", 10);
            if (!Number.isNaN(len) && len > 0) {
                this.totalBytes = len;
            }
        } catch (_) {
            // Ignore if HEAD not supported; we'll fill totalBytes on GET
        }
    }

    async getResumeStartByte() {
        if (await fs.pathExists(this.tempPath)) {
            const stats = await fs.stat(this.tempPath);
            return stats.size;
        }
        return 0;
    }

    async run(onProgress) {
        if (this.status === "completed") return; // skip
        this.status = "running";
        try {
            const startByte = await this.getResumeStartByte();

            const headers = {};
            if (startByte > 0) {
                headers["Range"] = `bytes=${startByte}-`;
            }

            const response = await axios.get(this.url, {
                responseType: "stream",
                headers
            });

            // Fill totalBytes if not set; combine with startByte when server returns partial length
            const contentLen = parseInt(response.headers["content-length"] ?? "0", 10);
            const total = (Number.isNaN(contentLen) ? 0 : contentLen) + startByte;
            if (total > 0) this.totalBytes = total;
            this.downloadedBytes = startByte;

            const writer = fs.createWriteStream(this.tempPath, { flags: "a" });

            response.data.on("data", (chunk) => {
                this.downloadedBytes += chunk.length;
                if (onProgress) onProgress(this);
            });

            await new Promise((resolve, reject) => {
                response.data.pipe(writer);
                response.data.on("error", reject);
                writer.on("finish", resolve);
                writer.on("error", reject);
            });

            await fs.rename(this.tempPath, this.destinationPath);
            this.status = "completed";
        } catch (err) {
            this.status = "failed";
            this.error = err;
            throw err;
        } finally {
            // Ensure .part is removed if we finished successfully
            if (this.status === "completed") {
                try {
                    if (await fs.pathExists(this.tempPath)) {
                        await fs.remove(this.tempPath);
                    }
                } catch {}
            }
        }
    }

    get progress() {
        if (this.totalBytes === 0) return 0;
        return (this.downloadedBytes / this.totalBytes) * 100;
    }

    get fileName() {
        return path.basename(this.destinationPath);
    }
}
