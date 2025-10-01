import readline from "readline";
import path from "path";

const ALT_BUFFER_ENABLE = "\u001b[?1049h";
const ALT_BUFFER_DISABLE = "\u001b[?1049l";
const CURSOR_HIDE = "\u001b[?25l";
const CURSOR_SHOW = "\u001b[?25h";

/**
 * ProgressRenderer exibe o andamento dos downloads utilizando o alternate
 * screen buffer do terminal, semelhante aos CLIs modernos (npm, docker).
 * A UI ocupa a tela inteira durante a execução e permite navegar pela lista
 * com as setas (↑/↓) ou PgUp/PgDn. Ao finalizar, o buffer padrão é restaurado
 * e um resumo é impresso na saída padrão.
 */
export default class ProgressRenderer {
    constructor({ intervalMs = 120, barWidth = 24 } = {}) {
        this.intervalMs = intervalMs;
        this.barWidth = barWidth;

        this.tasks = [];
        this.interval = null;

        this.isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
        this.altScreenActive = false;
        this.viewportOffset = 0;
        this.visibleCapacity = 0;
        this.screenRows = process.stdout.rows ?? 24;
        this._userScrolled = false;

        this._boundHandleInput = null;
        this._boundHandleResize = null;
        this._spinnerFrames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
        this._spinnerIndex = 0;

        this._finalSnapshot = null;
        this._fallbackRenderedOnce = false;
        this.nameColumnWidth = 70; // largura usada para alinhar as barras com o link
    }

    track(tasks) {
        this.tasks = tasks;
    }

    resetViewport() {
        this.viewportOffset = 0;
        this._userScrolled = false;
    }

    onProgress() {
        // o ticker periódico já cuida de redesenhar.
    }

    onComplete() {
        // o ticker periódico já cuida de redesenhar.
    }

    onError() {
        // idem.
    }

    start() {
        if (this.interval) return;

        this.resetViewport();

        if (this.isTty) {
            this._enterAltScreen();
        }

        this._render();
        this.interval = setInterval(() => this._render(), this.intervalMs);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        // captura um snapshot final para imprimir após sair do buffer alternativo
        this._finalSnapshot = this._composeSnapshot();

        if (this.isTty && this.altScreenActive) {
            this._render(true);
            this._leaveAltScreen();
        }

        this._printSummary();
    }

    _enterAltScreen() {
        if (this.altScreenActive) return;

        process.stdout.write(ALT_BUFFER_ENABLE);
        process.stdout.write(CURSOR_HIDE);
        this.altScreenActive = true;

        this._attachInput();
        this._boundHandleResize = () => {
            this.screenRows = process.stdout.rows ?? this.screenRows;
            this._render();
        };
        process.stdout.on("resize", this._boundHandleResize);
    }

    _leaveAltScreen() {
        if (!this.altScreenActive) return;

        process.stdout.write(CURSOR_SHOW);
        process.stdout.write(ALT_BUFFER_DISABLE);
        this.altScreenActive = false;

        this._detachInput();
        if (this._boundHandleResize) {
            process.stdout.off("resize", this._boundHandleResize);
            this._boundHandleResize = null;
        }
    }

    _attachInput() {
        if (!this.isTty) return;

        this.stdin = process.stdin;
        this._previousRawMode = this.stdin.isRaw;
        this.stdin.setRawMode(true);
        this.stdin.resume();

        this._boundHandleInput = (data) => this._handleInput(data);
        this.stdin.on("data", this._boundHandleInput);
    }

    _detachInput() {
        if (!this.stdin) return;

        if (this._boundHandleInput) {
            this.stdin.off("data", this._boundHandleInput);
            this._boundHandleInput = null;
        }

        if (this._previousRawMode !== undefined) {
            this.stdin.setRawMode(this._previousRawMode);
        }

        this.stdin = null;
        this._previousRawMode = undefined;
    }

    _handleInput(buffer) {
        const str = buffer.toString("utf8");

        // Ctrl+C
        if (str === "\u0003") {
            this.stop();
            process.kill(process.pid, "SIGINT");
            return;
        }

        // Escape sequences para setas e PgUp/PgDn
        if (str === "\u001b[A" || str === "k") { // Up
            this._userScrolled = true;
            this.viewportOffset = Math.max(0, this.viewportOffset - 1);
            this._render();
            return;
        }

        if (str === "\u001b[B" || str === "j") { // Down
            this._userScrolled = true;
            this.viewportOffset = Math.min(this.viewportOffset + 1, Math.max(0, this._maxViewportOffset()));
            this._render();
            return;
        }

        if (str === "\u001b[5~") { // PgUp
            this._userScrolled = true;
            this.viewportOffset = Math.max(0, this.viewportOffset - this.visibleCapacity);
            this._render();
            return;
        }

        if (str === "\u001b[6~") { // PgDn
            this._userScrolled = true;
            this.viewportOffset = Math.min(this.viewportOffset + this.visibleCapacity, Math.max(0, this._maxViewportOffset()));
            this._render();
            return;
        }

    }

    _maxViewportOffset() {
        const orderedLength = this._lastOrderedLength ?? 0;
        return Math.max(0, orderedLength - this.visibleCapacity);
    }

    _render(final = false) {
        if (!this.isTty) {
            if (!this._fallbackRenderedOnce || final) {
                const { header, footer } = this._composeSummary();
                console.log(header);
                if (footer) console.log(footer);
                this._fallbackRenderedOnce = true;
            }
            return;
        }

        this.screenRows = process.stdout.rows ?? this.screenRows;
        const snapshot = this._composeSnapshot();
        this.visibleCapacity = snapshot.visibleCapacity;
        this._lastOrderedLength = snapshot.totalItems;

        readline.cursorTo(process.stdout, 0, 0);
        readline.clearScreenDown(process.stdout);

        snapshot.lines.forEach((line) => {
            process.stdout.write(line + "\n");
        });

        if (final) {
            // deixa a tela com a última renderização até sair do alt buffer.
        }

        this._spinnerIndex = (this._spinnerIndex + 1) % this._spinnerFrames.length;
    }

    _composeSnapshot() {
        const spinner = this._spinnerFrames[this._spinnerIndex];

        const total = this.tasks.length;
        const completedItems = this.tasks.filter((t) => t.status === "completed");
        const failedItems = this.tasks.filter((t) => t.status === "failed");
        const runningItems = this.tasks.filter((t) => t.status === "running");
        const queuedItems = this.tasks.filter((t) => t.status === "queued");

        const completedCount = completedItems.length;
        const failedCount = failedItems.length;
        const runningCount = runningItems.length;
        const queuedCount = queuedItems.length;

        // bytes totais e baixados
        const totalBytes = this.tasks.reduce((acc, t) => acc + (t.totalBytes || 0), 0);
        const downloadedBytes = this.tasks.reduce((acc, t) => {
            if (t.status === "completed") {
                return acc + (t.totalBytes || t.downloadedBytes || 0);
            }
            return acc + (t.downloadedBytes || 0);
        }, 0);

        // taxa média (EMA) calculada na própria coleta dos dados
        const now = Date.now();
        if (!this._throughputState) {
            this._throughputState = {
                lastAt: now,
                lastBytes: downloadedBytes,
                ema: 0,
            };
        } else {
            const dt = (now - this._throughputState.lastAt) / 1000;
            if (dt >= 0.2) {
                const delta = Math.max(0, downloadedBytes - this._throughputState.lastBytes);
                const instant = delta / (dt || 1);
                this._throughputState.ema = this._throughputState.ema === 0
                    ? instant
                    : (this._throughputState.ema * 0.75 + instant * 0.25);
                this._throughputState.lastAt = now;
                this._throughputState.lastBytes = downloadedBytes;
            }
        }

        const speedBytes = this._throughputState?.ema || 0;

        // Layout
        const rows = this.screenRows || 24;
        const header = `[+] Downloading ${runningCount}/${total} • concluídos ${completedCount}${failedCount ? ` • falhas ${failedCount}` : ""}`;

        const sections = [
            { title: `Concluídos (${completedCount})`, items: completedItems },
            { title: `Falhas (${failedCount})`, items: failedItems },
            { title: `Aguardando (${queuedCount})`, items: queuedItems },
            { title: `Em progresso (${runningCount})`, items: runningItems },
        ];

        const bodyLines = [];
        sections.forEach((section, index) => {
            bodyLines.push(section.title);
            if (section.items.length === 0) {
                bodyLines.push("  —");
            } else {
                section.items.forEach((task) => {
                    const line = this._renderTaskLine(task, spinner);
                    if (task.status === "running") {
                        bodyLines.push(`${spinner} ${line}`);
                    } else {
                        bodyLines.push(`  ${line}`);
                    }
                });
            }
            if (index !== sections.length - 1) {
                bodyLines.push("");
            }
        });

        const availableListRows = Math.max(0, rows - 2); // header + footer
        const maxOffset = Math.max(0, bodyLines.length - availableListRows);

        if (runningCount > 0 && !this._userScrolled) {
            const lastSectionIndex = bodyLines.length - availableListRows;
            this.viewportOffset = Math.max(0, Math.min(lastSectionIndex, maxOffset));
        } else {
            this.viewportOffset = Math.min(this.viewportOffset, maxOffset);
        }

        const startIndex = this.viewportOffset;
        const endIndex = Math.min(startIndex + availableListRows, bodyLines.length);
        const visibleBody = bodyLines.slice(startIndex, endIndex);

        const footerParts = [];
        const showing = bodyLines.length === 0
            ? "0 de 0"
            : `${startIndex + 1}-${endIndex} de ${bodyLines.length}`;

        const downloadedLabel = formatBytes(downloadedBytes);
        const totalLabel = totalBytes ? formatBytes(totalBytes) : null;
        footerParts.push(`Baixados: ${totalLabel ? `${downloadedLabel} / ${totalLabel}` : downloadedLabel}`);
        footerParts.push(`Velocidade: ${formatBytes(speedBytes)}/s`);
        footerParts.push(`Exibindo ${showing}`);
        footerParts.push(`Em andamento: ${runningCount}`);
        footerParts.push(`Fila: ${queuedCount}`);

        if (speedBytes > 0 && totalBytes > downloadedBytes) {
            const remainingBytes = totalBytes - downloadedBytes;
            const etaSeconds = remainingBytes / speedBytes;
            footerParts.push(`ETA: ${formatDuration(etaSeconds)}`);
        }

        const footer = footerParts.join(" • ");

        const lines = [header, ...visibleBody, footer];

        return {
            lines,
            header,
            footer,
            totalItems: bodyLines.length,
            visibleCapacity: availableListRows,
        };
    }

    _renderTaskLine(task, spinnerFrame) {
        const displayName = formatDestination(task);

        if (task.status === "failed") {
            const message = (task.error?.message || "falha")
                .replace(/\s+/g, " ")
                .trim();
            return `✖ ${displayName} — ${message}`;
        }

        if (task.status === "completed") {
            const sizeLabel = task.totalBytes ? formatBytes(task.totalBytes) : "completo";
            return `✔ ${displayName} (${sizeLabel})`;
        }

        const percent = Math.min(task.progress || 0, 100);
        const filled = Math.round((this.barWidth * percent) / 100);
        const bar = "█".repeat(filled) + "-".repeat(this.barWidth - filled);
        const downloaded = formatBytes(task.downloadedBytes || 0);
        const total = task.totalBytes ? formatBytes(task.totalBytes) : null;

        if (task.status === "running") {
            const progressLabel = total ? `${downloaded} / ${total}` : downloaded;
            const paddedName = padForColumn(displayName, this.nameColumnWidth);
            return `${paddedName} |${bar}| ${percent.toFixed(1)}% ${progressLabel}`;
        }

        // queued
        if (task.downloadedBytes > 0 && task.totalBytes > 0) {
            const progressLabel = `${downloaded} / ${total}`;
            const paddedName = padForColumn(displayName, this.nameColumnWidth);
            return `${paddedName} |${bar}| ${percent.toFixed(1)}% ${progressLabel} (na fila)`;
        }

        return `${displayName}`;
    }

    _composeSummary() {
        const total = this.tasks.length;
        const completed = this.tasks.filter((t) => t.status === "completed");
        const failed = this.tasks.filter((t) => t.status === "failed");

        const header = `Downloads finalizados: ${completed.length}/${total}${failed.length ? ` • Falhas: ${failed.length}` : ""}`;

        const lines = failed.map((task) => {
            const reason = task.error?.message || "falha";
            return `  - ${task.fileName}: ${reason}`;
        });

        return { header, footer: lines.join("\n") };
    }

    _printSummary() {
        if (!this._finalSnapshot) {
            this._finalSnapshot = this._composeSnapshot();
        }

        const { header, footer } = this._composeSummary();

        console.log(header);
        if (footer) {
            console.log(footer);
        }

        const footerLine = this._finalSnapshot.footer;
        if (footerLine) {
            console.log(footerLine);
        }
    }
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const formatted = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
    return `${formatted} ${units[unitIndex]}`;
}

function formatDuration(seconds) {
    const sec = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const remaining = sec % 60;

    if (hrs > 0) {
        return `${hrs}h ${mins}m ${remaining}s`;
    }
    if (mins > 0) {
        return `${mins}m ${remaining}s`;
    }
    return `${remaining}s`;
}

function formatDestination(task) {
    if (!task?.destinationPath) {
        return task?.fileName ?? "";
    }

    return path.basename(task.destinationPath);
}

function padForColumn(value, width) {
    if (value.length >= width) {
        return value;
    }
    return value.padEnd(width, ' ');
}
