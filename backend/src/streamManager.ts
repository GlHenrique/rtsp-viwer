import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, unlink } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Pasta estável: mesmo que o servidor seja arrancado noutra pasta de trabalho. */
const HLS_DIR = join(__dirname, "..", "hls-cache");

export function getHlsDirectory(): string {
  return HLS_DIR;
}
const PLAYLIST_NAME = "stream.m3u8";

let ffmpeg: ChildProcess | null = null;
let lastError: string | null = null;

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
    "expr:gte(t,n_forced*2)",
    "-f",
    "hls",
    "-hls_time",
    "2",
    /* Janela larga: com delete_segments, lista curta apagava .ts antes do browser pedir → buracos de ~10s. */
    "-hls_list_size",
    "20",
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
