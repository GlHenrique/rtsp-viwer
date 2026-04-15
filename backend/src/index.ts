import { config as loadEnv } from "dotenv";
import cors from "cors";
import express from "express";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getHlsDirectory,
  getPlaylistPath,
  getStatus,
  startStream,
  stopStream,
} from "./streamManager.js";
import { fetchOnvifRtspStreams } from "./onvifService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

const hlsDir = getHlsDirectory();

app.get("/hls/stream.m3u8", (_req, res) => {
  const playlist = path.join(hlsDir, "stream.m3u8");
  if (!existsSync(playlist)) {
    res.status(503).json({
      error: "Playlist HLS ainda não existe.",
      hint:
        "Inicie o stream com POST /api/stream/start ou o botão «Iniciar» no frontend. O ficheiro só é criado quando o FFmpeg começa a receber o fluxo RTSP.",
    });
    return;
  }
  res.setHeader(
    "Content-Type",
    "application/vnd.apple.mpegurl; charset=utf-8"
  );
  res.sendFile(path.resolve(playlist));
});

app.use(
  "/hls",
  express.static(hlsDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".m3u8")) {
        res.setHeader(
          "Content-Type",
          "application/vnd.apple.mpegurl; charset=utf-8"
        );
      } else if (filePath.endsWith(".ts")) {
        res.setHeader("Content-Type", "video/mp2t");
      }
    },
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "rtsp-viewer-backend" });
});

app.get("/api/stream/status", (_req, res) => {
  res.json(getStatus());
});

app.post("/api/stream/start", async (req, res) => {
  const bodyUrl =
    typeof req.body?.url === "string" ? req.body.url.trim() : "";
  const envUrl = (process.env.RTSP_URL ?? "").trim();
  const url = bodyUrl || envUrl;

  if (!url) {
    res.status(400).json({
      error:
        "Defina a URL RTSP no corpo { \"url\": \"...\" } ou na variável de ambiente RTSP_URL.",
    });
    return;
  }

  try {
    await startStream(url);
    res.json({
      ok: true,
      playlistPath: getPlaylistPath(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

app.post("/api/stream/stop", (_req, res) => {
  stopStream();
  res.json({ ok: true });
});

app.post("/api/onvif/rtsp-streams", async (req, res) => {
  const hostname =
    typeof req.body?.hostname === "string" ? req.body.hostname.trim() : "";
  const username =
    typeof req.body?.username === "string" ? req.body.username : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  const rawPort = req.body?.port;
  const port =
    rawPort === undefined || rawPort === null || rawPort === ""
      ? undefined
      : Number(rawPort);
  const pathStr =
    typeof req.body?.path === "string" ? req.body.path.trim() : undefined;

  if (!hostname) {
    res.status(400).json({ error: "Indique o IP ou hostname da câmara (hostname)." });
    return;
  }
  if (!username) {
    res.status(400).json({ error: "Indique o utilizador ONVIF (username)." });
    return;
  }

  try {
    const streams = await fetchOnvifRtspStreams({
      hostname,
      username,
      password,
      ...(Number.isFinite(port) && port !== undefined && port > 0
        ? { port: Math.trunc(port) }
        : {}),
      ...(pathStr ? { path: pathStr } : {}),
    });
    res.json({ ok: true, streams });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`API em http://localhost:${PORT}`);
  console.log(`HLS em http://localhost:${PORT}${getPlaylistPath()}`);
});
