import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Pasta estável: mesmo que o servidor seja arrancado noutra pasta de trabalho. */
const HLS_DIR = join(__dirname, "..", "hls-cache");
const SNAPSHOTS_DIR = join(__dirname, "..", "snapshots");

export function getHlsDirectory(): string {
  return HLS_DIR;
}

export function getSnapshotsDirectory(): string {
  return SNAPSHOTS_DIR;
}
const PLAYLIST_NAME = "stream.m3u8";

let ffmpeg: ChildProcess | null = null;
let lastError: string | null = null;
/** Última URL RTSP conhecida (stream iniciado ou snapshot); não exige HLS pronto. */
let lastRtspUrl: string | null = null;

export function getPlaylistPath(): string {
  return `/hls/${PLAYLIST_NAME}`;
}

export function getStatus() {
  return {
    running: ffmpeg !== null && !ffmpeg.killed,
    lastError,
    playlistPath: getPlaylistPath(),
  };
}

/** Corpo/query `{ url }`, última URL usada em stream/snapshot, ou `RTSP_URL` no `.env`. */
export function resolveRtspUrl(bodyUrl?: string | null): string | null {
  const trimmed = typeof bodyUrl === "string" ? bodyUrl.trim() : "";
  if (trimmed) return trimmed;
  if (lastRtspUrl) return lastRtspUrl;
  const envUrl = (process.env.RTSP_URL ?? "").trim();
  return envUrl || null;
}

async function ensureSnapshotsDir(): Promise<void> {
  await mkdir(SNAPSHOTS_DIR, { recursive: true });
}

/**
 * Captura um frame JPEG atual do RTSP (processo FFmpeg separado do HLS),
 * grava em `snapshots/` e devolve o buffer para a resposta HTTP.
 */
export async function captureSnapshot(
  rtspUrl: string
): Promise<{ buffer: Buffer; fileName: string; relativePath: string }> {
  const trimmed = rtspUrl.trim();
  if (!trimmed.toLowerCase().startsWith("rtsp://")) {
    throw new Error("URL deve começar com rtsp://");
  }

  lastRtspUrl = trimmed;

  const timeoutRaw = Number(process.env.SNAPSHOT_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.floor(timeoutRaw)
      : 30_000;

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stderrLines: string[] = [];

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-rtsp_transport",
      "tcp",
      "-i",
      trimmed,
      "-an",
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ];

    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      reject(new Error("Tempo esgotado ao capturar snapshot."));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) stderrLines.push(line);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      if (code === 0 && out.length > 0) {
        resolve(out);
        return;
      }
      const hint =
        stderrLines.length > 0
          ? stderrLines[stderrLines.length - 1]
          : `código ${String(code)}`;
      reject(
        new Error(
          code === 0 && out.length === 0
            ? "FFmpeg não devolveu imagem (saída vazia)."
            : `Falha ao capturar snapshot: ${hint}`
        )
      );
    });
  });

  await ensureSnapshotsDir();
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const fileName = `snapshot-${y}-${mo}-${day}.jpg`;
  const fsPath = join(SNAPSHOTS_DIR, fileName);
  await writeFile(fsPath, buffer);
  const relativePath = join("snapshots", fileName).replace(/\\/g, "/");

  return { buffer, fileName, relativePath };
}

async function ensureHlsDir(): Promise<void> {
  await mkdir(HLS_DIR, { recursive: true });
}

async function clearHlsDir(): Promise<void> {
  if (!existsSync(HLS_DIR)) return;
  const files = await readdir(HLS_DIR);
  await Promise.all(files.map((f) => unlink(join(HLS_DIR, f))));
}

function killFfmpeg(): void {
  if (!ffmpeg || ffmpeg.killed) {
    ffmpeg = null;
    return;
  }
  try {
    ffmpeg.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  ffmpeg = null;
}

function playlistLooksReady(content: string): boolean {
  const t = content.trim();
  if (!t.startsWith("#EXTM3U")) return false;
  return /\.ts\b/i.test(t) || /#EXTINF:/i.test(t);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPlaylistReady(
  playlistFsPath: string,
  child: ChildProcess,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode != null) {
      throw new Error(
        lastError ??
          `FFmpeg terminou (código ${String(child.exitCode)}, sinal ${String(
            child.signalCode
          )}) antes da playlist HLS ficar disponível.`
      );
    }

    if (existsSync(playlistFsPath)) {
      try {
        const buf = await readFile(playlistFsPath);
        if (buf.length > 0 && playlistLooksReady(buf.toString("utf-8"))) {
          return;
        }
      } catch {
        /* ficheiro ainda a ser escrito */
      }
    }

    await sleep(200);
  }

  throw new Error("Tempo esgotado à espera da playlist HLS.");
}

export async function startStream(rtspUrl: string): Promise<void> {
  const trimmed = rtspUrl.trim();
  if (!trimmed.toLowerCase().startsWith("rtsp://")) {
    throw new Error("URL deve começar com rtsp://");
  }

  lastRtspUrl = trimmed;

  const readyTimeoutRaw = Number(process.env.HLS_READY_TIMEOUT_MS);
  const readyTimeoutMs =
    Number.isFinite(readyTimeoutRaw) && readyTimeoutRaw > 0
      ? Math.floor(readyTimeoutRaw)
      : 120_000;

  lastError = null;
  killFfmpeg();
  await ensureHlsDir();
  await clearHlsDir();

  /** `error` evita inundação de avisos MJPEG/swscaler/frames duplicados (definir FFMPEG_LOGLEVEL=warning para depuração). */
  const ffmpegLogLevel = (process.env.FFMPEG_LOGLEVEL ?? "error").trim() || "error";

  const args = [
    "-hide_banner",
    "-loglevel",
    ffmpegLogLevel,
    "-nostats",
    /* Menos buffer; +discardcorrupt ajuda streams MJPEG com frames estragados. */
    "-fflags",
    "nobuffer+discardcorrupt",
    "-flags",
    "low_delay",
    "-rtsp_transport",
    "tcp",
    "-i",
    trimmed,
    "-an",
    /* Menos duplicação artificial de frames quando o FPS do MJPEG/RTSP oscila. */
    "-fps_mode",
    "passthrough",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    /* Um keyframe por segmento — evita cortes inválidos e saltos no player. */
    "-force_key_frames",
    "expr:gte(t,n_forced*1)",
    "-f",
    "hls",
    "-hls_time",
    "1",
    /* Janela larga: com delete_segments, lista curta apagava .ts antes do browser pedir → buracos de ~10s. */
    "-hls_list_size",
    "6",
    "-hls_flags",
    "delete_segments+append_list+omit_endlist",
    "-hls_segment_filename",
    "segment_%03d.ts",
    PLAYLIST_NAME,
  ];

  const child = spawn("ffmpeg", args, {
    cwd: HLS_DIR,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  ffmpeg = child;

  child.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.warn("[ffmpeg]", line);
  });

  child.on("error", (err) => {
    lastError = err.message;
    console.error("[ffmpeg] spawn error:", err.message);
    if (ffmpeg === child) ffmpeg = null;
  });

  child.on("close", (code, signal) => {
    if (ffmpeg === child) ffmpeg = null;
    if (code !== 0 && code !== null) {
      const msg = signal
        ? `FFmpeg terminou (sinal ${signal})`
        : `FFmpeg saiu com código ${code}`;
      lastError = lastError ?? msg;
      console.warn("[ffmpeg]", msg);
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        child.off("error", onErr);
        reject(new Error("FFmpeg não arrancou a tempo (spawn)."));
      }, 15_000);

      function onErr(err: Error) {
        clearTimeout(t);
        reject(err);
      }

      child.once("error", onErr);
      child.once("spawn", () => {
        clearTimeout(t);
        child.off("error", onErr);
        resolve();
      });
    });

    await waitForPlaylistReady(join(HLS_DIR, PLAYLIST_NAME), child, readyTimeoutMs);
  } catch (e) {
    killFfmpeg();
    throw e;
  }
}

export function stopStream(): void {
  lastError = null;
  killFfmpeg();
}
