import { config as loadEnv } from "dotenv";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import swaggerUi from "swagger-ui-express";
import { createOpenApiSpec } from "./openapi.js";
import {
  captureSnapshot,
  getHlsDirectory,
  getPlaylistPath,
  getStatus,
  resolveRtspUrl,
  startStream,
  stopStream,
} from "./streamManager.js";
import { fetchOnvifRtspStreams } from "./onvifService.js";
import {
  configureBambuWebhook,
  connectBambu,
  connectBambuCloud,
  disconnectBambu,
  getBambuCloudDebugIdentity,
  getBambuStatus,
  getBambuCloudWhoAmI,
  sendBambuCloudEmailCode,
  startBambuCloudLogin,
  verifyBambuCloudEmailCode,
} from "./bambuService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

const openApiSpec = createOpenApiSpec(PORT);

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

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

async function snapshotHandler(req: Request, res: Response): Promise<void> {
  const explicit =
    (typeof req.body?.url === "string" ? req.body.url.trim() : "") ||
    (typeof req.query?.url === "string" ? String(req.query.url).trim() : "");
  const url = resolveRtspUrl(explicit || null);

  if (!url) {
    res.status(400).json({
      error:
        'Indique a URL RTSP em ?url= ou no corpo { "url": "..." }, ou defina RTSP_URL. Depois do primeiro stream ou snapshot com URL, pode omitir.',
    });
    return;
  }

  try {
    const { buffer, relativePath } = await captureSnapshot(url);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Snapshot-Path", relativePath);
    res.send(buffer);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: message });
  }
}

app.get("/api/snapshot", snapshotHandler);
app.post("/api/snapshot", snapshotHandler);

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

app.get("/api/bambu/status", (_req, res) => {
  res.json(getBambuStatus());
});

app.post("/api/bambu/connect", async (req, res) => {
  const host = typeof req.body?.host === "string" ? req.body.host.trim() : undefined;
  const serial = typeof req.body?.serial === "string" ? req.body.serial.trim() : undefined;
  const accessCode =
    typeof req.body?.accessCode === "string" ? req.body.accessCode.trim() : undefined;
  const username =
    typeof req.body?.username === "string" ? req.body.username.trim() : undefined;
  const protocol =
    req.body?.protocol === "mqtt" || req.body?.protocol === "mqtts"
      ? req.body.protocol
      : undefined;
  const port =
    req.body?.port === undefined || req.body?.port === null || req.body?.port === ""
      ? undefined
      : Number(req.body.port);
  const rejectUnauthorized =
    typeof req.body?.rejectUnauthorized === "boolean"
      ? req.body.rejectUnauthorized
      : undefined;

  try {
    await connectBambu({
      host,
      serial,
      accessCode,
      username,
      protocol,
      ...(Number.isFinite(port) && port !== undefined && port > 0
        ? { port: Math.trunc(port) }
        : {}),
      ...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
    });
    res.json({ ok: true, status: getBambuStatus() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

app.post("/api/bambu/connect-cloud", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : undefined;
  const serial = typeof req.body?.serial === "string" ? req.body.serial.trim() : undefined;
  const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : undefined;
  const region = req.body?.region === "china" ? "china" : req.body?.region === "global" ? "global" : undefined;
  const rejectUnauthorized =
    typeof req.body?.rejectUnauthorized === "boolean"
      ? req.body.rejectUnauthorized
      : undefined;

  try {
    await connectBambuCloud({
      token,
      serial,
      userId,
      region,
      ...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
    });
    res.json({ ok: true, status: getBambuStatus() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

app.post("/api/bambu/disconnect", (_req, res) => {
  disconnectBambu();
  res.json({ ok: true, status: getBambuStatus() });
});

app.post("/api/bambu/webhook", (req, res) => {
  const urlRaw = req.body?.url;
  const enabledRaw = req.body?.enabled;
  const url =
    typeof urlRaw === "string" ? urlRaw.trim() : urlRaw === null ? null : undefined;
  const enabled = typeof enabledRaw === "boolean" ? enabledRaw : undefined;

  if (url !== undefined && url !== null) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        res.status(400).json({ error: "Webhook URL deve usar http:// ou https://." });
        return;
      }
    } catch {
      res.status(400).json({ error: "Webhook URL inválida." });
      return;
    }
  }

  const configured = configureBambuWebhook({ url, enabled });
  res.json({ ok: true, ...configured, status: getBambuStatus() });
});

app.post("/api/bambu/cloud-auth/start", async (req, res) => {
  const account = typeof req.body?.account === "string" ? req.body.account.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const region = req.body?.region === "china" ? "china" : "global";
  if (!account || !password) {
    res.status(400).json({ error: "Informe account e password." });
    return;
  }

  try {
    const loginResult = await startBambuCloudLogin({ account, password, region });
    if (loginResult.loginType === "verifyCode") {
      await sendBambuCloudEmailCode({ account, region });
      res.json({
        ok: true,
        loginType: "verifyCode",
        message: "Código enviado por email. Use /api/bambu/cloud-auth/verify.",
      });
      return;
    }

    res.json({
      ok: true,
      loginType: "token",
      accessToken: loginResult.accessToken,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

app.post("/api/bambu/cloud-auth/verify", async (req, res) => {
  const account = typeof req.body?.account === "string" ? req.body.account.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const region = req.body?.region === "china" ? "china" : "global";
  if (!account || !code) {
    res.status(400).json({ error: "Informe account e code." });
    return;
  }

  try {
    const result = await verifyBambuCloudEmailCode({ account, code, region });
    res.json({ ok: true, accessToken: result.accessToken });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

app.post("/api/bambu/cloud-auth/whoami", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const region = req.body?.region === "china" ? "china" : "global";
  if (!token) {
    res.status(400).json({ error: "Informe token." });
    return;
  }

  try {
    const result = await getBambuCloudWhoAmI({ token, region });
    res.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

app.post("/api/bambu/cloud-auth/debug-identity", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const region = req.body?.region === "china" ? "china" : "global";
  if (!token) {
    res.status(400).json({ error: "Informe token." });
    return;
  }

  try {
    const result = await getBambuCloudDebugIdentity({ token, region });
    res.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`API em http://localhost:${PORT}`);
  console.log(`HLS em http://localhost:${PORT}${getPlaylistPath()}`);
  console.log(`Swagger em http://localhost:${PORT}/api/docs`);
});
