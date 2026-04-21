import { connect, type IClientOptions, type MqttClient } from "mqtt";

type BambuConnectOptions = {
  host: string;
  serial: string;
  accessCode: string;
  port?: number;
  username?: string;
  protocol?: "mqtt" | "mqtts";
  rejectUnauthorized?: boolean;
};

type BambuCloudConnectOptions = {
  token?: string;
  serial?: string;
  userId?: string;
  region?: "global" | "china";
  rejectUnauthorized?: boolean;
};

type BambuCloudRegion = "global" | "china";

type BambuCloudDevice = {
  serial: string;
  userId: string;
  mqttHost: string;
  mqttPasswords: string[];
};

type LayerEvent = {
  layer: number;
  previousLayer: number | null;
  at: string;
};

export type LayerCompletedEvent = {
  layer: number;
  previousLayer: number | null;
  at: string;
  totalLayers: number | null;
  serial: string | null;
  source: "local" | "cloud" | null;
};

type BambuState = {
  connected: boolean;
  connecting: boolean;
  host: string | null;
  port: number | null;
  serial: string | null;
  topic: string | null;
  source: "local" | "cloud" | null;
  lastError: string | null;
  lastRawReportAt: string | null;
  lastLayer: number | null;
  lastLayerCompletedAt: string | null;
  totalLayers: number | null;
  recentLayerEvents: LayerEvent[];
  webhookUrl: string | null;
  webhookEnabled: boolean;
  lastWebhookAt: string | null;
  lastWebhookStatus: number | null;
  lastWebhookError: string | null;
};

const MAX_RECENT_LAYER_EVENTS = 20;

let client: MqttClient | null = null;
let activeTopic: string | null = null;
const layerCompletedListeners = new Set<(event: LayerCompletedEvent) => void | Promise<void>>();

const state: BambuState = {
  connected: false,
  connecting: false,
  host: null,
  port: null,
  serial: null,
  topic: null,
  source: null,
  lastError: null,
  lastRawReportAt: null,
  lastLayer: null,
  lastLayerCompletedAt: null,
  totalLayers: null,
  recentLayerEvents: [],
  webhookUrl: null,
  webhookEnabled: false,
  lastWebhookAt: null,
  lastWebhookStatus: null,
  lastWebhookError: null,
};

function sanitizeInt(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const intVal = Math.trunc(num);
  return intVal >= 0 ? intVal : null;
}

function findFirstIntByKeys(
  input: unknown,
  keys: Set<string>,
  depth = 0
): number | null {
  if (depth > 6 || !input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  for (const [k, v] of Object.entries(obj)) {
    if (keys.has(k)) {
      const maybe = sanitizeInt(v);
      if (maybe !== null) return maybe;
    }
  }

  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const nested = findFirstIntByKeys(v, keys, depth + 1);
      if (nested !== null) return nested;
    }
  }

  return null;
}

function detectLayerInfo(payload: unknown): { current: number | null; total: number | null } {
  const currentKeys = new Set([
    "layer_num",
    "current_layer",
    "layer",
    "layer_index",
    "layerNumber",
  ]);
  const totalKeys = new Set(["total_layer_num", "total_layers", "layer_count"]);

  return {
    current: findFirstIntByKeys(payload, currentKeys),
    total: findFirstIntByKeys(payload, totalKeys),
  };
}

function applyLayerUpdate(currentLayer: number | null, totalLayers: number | null): void {
  if (totalLayers !== null) {
    state.totalLayers = totalLayers;
  }
  if (currentLayer === null) return;

  if (state.lastLayer === null) {
    state.lastLayer = currentLayer;
    return;
  }

  if (currentLayer > state.lastLayer) {
    const now = new Date().toISOString();
    const previousLayer = state.lastLayer;
    state.recentLayerEvents.unshift({
      layer: currentLayer,
      previousLayer,
      at: now,
    });
    if (state.recentLayerEvents.length > MAX_RECENT_LAYER_EVENTS) {
      state.recentLayerEvents.length = MAX_RECENT_LAYER_EVENTS;
    }
    state.lastLayer = currentLayer;
    state.lastLayerCompletedAt = now;
    const event: LayerCompletedEvent = {
      layer: currentLayer,
      previousLayer,
      at: now,
      totalLayers: state.totalLayers,
      serial: state.serial,
      source: state.source,
    };
    void fireLayerWebhook(event);
    for (const listener of layerCompletedListeners) {
      void Promise.resolve(listener(event)).catch(() => {
        // ignore listener errors to avoid breaking MQTT processing
      });
    }
    return;
  }

  state.lastLayer = currentLayer;
}

function resetConnectionState(): void {
  state.connected = false;
  state.connecting = false;
  state.topic = null;
  state.source = null;
}

function resolveOption(
  direct: string | undefined,
  envValue: string | undefined,
  fallback = ""
): string {
  const v = (direct ?? envValue ?? fallback).trim();
  return v;
}

type WebhookPayload = {
  layer: number;
  previousLayer: number | null;
  at: string;
  totalLayers: number | null;
  serial: string | null;
  source: "local" | "cloud" | null;
};

async function fireLayerWebhook(payload: WebhookPayload): Promise<void> {
  if (!state.webhookEnabled || !state.webhookUrl) return;
  try {
    const response = await fetch(state.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "bambu.layer_completed",
        ...payload,
      }),
    });
    state.lastWebhookAt = new Date().toISOString();
    state.lastWebhookStatus = response.status;
    state.lastWebhookError = response.ok ? null : `Webhook respondeu ${response.status}`;
  } catch (e) {
    state.lastWebhookAt = new Date().toISOString();
    state.lastWebhookStatus = null;
    state.lastWebhookError = e instanceof Error ? e.message : String(e);
  }
}

export function configureBambuWebhook(options: {
  url?: string | null;
  enabled?: boolean;
}): {
  webhookUrl: string | null;
  webhookEnabled: boolean;
} {
  if (options.url !== undefined) {
    const raw = (options.url ?? "").trim();
    state.webhookUrl = raw || null;
  }
  if (options.enabled !== undefined) {
    state.webhookEnabled = options.enabled;
  } else if (options.url !== undefined && state.webhookUrl) {
    state.webhookEnabled = true;
  }

  if (!state.webhookUrl) {
    state.webhookEnabled = false;
  }

  return {
    webhookUrl: state.webhookUrl,
    webhookEnabled: state.webhookEnabled,
  };
}

export async function connectBambu(options: Partial<BambuConnectOptions>): Promise<void> {
  const host = resolveOption(options.host, process.env.BAMBU_HOST);
  const serial = resolveOption(options.serial, process.env.BAMBU_SERIAL);
  const accessCode = resolveOption(options.accessCode, process.env.BAMBU_ACCESS_CODE);
  const username = resolveOption(options.username, process.env.BAMBU_USERNAME, "bblp");
  const protocol =
    (resolveOption(options.protocol, process.env.BAMBU_PROTOCOL, "mqtts") as "mqtt" | "mqtts") ||
    "mqtts";
  const portRaw =
    options.port ??
    (process.env.BAMBU_PORT ? Number(process.env.BAMBU_PORT) : protocol === "mqtts" ? 8883 : 1883);
  const port = Number.isFinite(portRaw) ? Math.trunc(portRaw) : NaN;
  const rejectUnauthorized =
    options.rejectUnauthorized ??
    (process.env.BAMBU_TLS_REJECT_UNAUTHORIZED ?? "false").toLowerCase() === "true";

  if (!host) throw new Error("BAMBU_HOST não definido.");
  if (!serial) throw new Error("BAMBU_SERIAL não definido.");
  if (!accessCode) throw new Error("BAMBU_ACCESS_CODE não definido.");
  if (!Number.isFinite(port) || port <= 0) throw new Error("Porta BAMBU_PORT inválida.");
  if (state.connecting) throw new Error("Ligação à Bambu já em progresso.");

  const clientOptions: IClientOptions = {
    protocol,
    host,
    port,
    username,
    password: accessCode,
    reconnectPeriod: 5000,
    connectTimeout: 15_000,
    rejectUnauthorized,
  };

  await connectToMqtt(clientOptions, serial, "local");
}

function parseJsonObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  return input as Record<string, unknown>;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function findFirstStringByKeys(
  input: unknown,
  keys: Set<string>,
  depth = 0
): string | null {
  if (depth > 8 || !input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  for (const [k, v] of Object.entries(obj)) {
    if (keys.has(k) && typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }

  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const nested = findFirstStringByKeys(v, keys, depth + 1);
      if (nested) return nested;
    }
  }

  return null;
}

function detectUserIdFromAnyPayload(payload: unknown): string | null {
  return findFirstStringByKeys(
    payload,
    new Set([
      "uid",
      "user_id",
      "userId",
      "account_id",
      "accountId",
      "owner_id",
      "ownerId",
      "id",
      "sub",
    ])
  );
}

function extractDevices(payload: unknown): Record<string, unknown>[] {
  const root = parseJsonObject(payload);
  if (!root) return [];

  const direct = root.devices;
  if (Array.isArray(direct)) return direct.filter((item) => typeof item === "object") as Record<
    string,
    unknown
  >[];

  const data = parseJsonObject(root.data);
  if (!data) return [];
  const nested = data.devices;
  if (Array.isArray(nested)) {
    return nested.filter((item) => typeof item === "object") as Record<string, unknown>[];
  }
  return [];
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(base64 + padding, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as unknown;
    return parseJsonObject(parsed);
  } catch {
    return null;
  }
}

function extractUserIdFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return firstString(payload, ["user_id", "uid", "sub", "account_id"]);
}

async function fetchCloudDeviceInfo(
  token: string,
  serialHint: string | undefined,
  region: BambuCloudRegion,
  userIdHint?: string
): Promise<BambuCloudDevice> {
  const baseApi = region === "china" ? "https://api.bambulab.cn" : "https://api.bambulab.com";
  const mqttHost = region === "china" ? "cn.mqtt.bambulab.com" : "us.mqtt.bambulab.com";

  const response = await fetch(`${baseApi}/v1/iot-service/api/user/bind`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Falha ao consultar dispositivos cloud (${response.status}).`);
  }
  const body = (await response.json()) as unknown;
  const devices = extractDevices(body);
  if (devices.length === 0) {
    throw new Error("Nenhuma impressora vinculada encontrada na conta Bambu.");
  }

  const selected =
    (serialHint
      ? devices.find((item) => {
          const serial = firstString(item, ["dev_id", "serial", "deviceId", "device_id"]);
          return serial?.toLowerCase() === serialHint.toLowerCase();
        })
      : devices[0]) ?? null;
  if (!selected) {
    throw new Error("Impressora não encontrada para o serial informado.");
  }

  const serial = firstString(selected, ["dev_id", "serial", "deviceId", "device_id"]);
  const accessCode = firstString(selected, ["dev_access_code", "accessCode", "access_code"]);
  const mqttToken =
    firstString(selected, ["mqtt_token", "mqttToken"]) ??
    firstString(parseJsonObject(body) ?? {}, ["mqtt_token", "mqttToken"]) ??
    firstString(parseJsonObject((parseJsonObject(body) ?? {}).data) ?? {}, [
      "mqtt_token",
      "mqttToken",
    ]);
  const explicitUserId = userIdHint?.trim() || null;
  const userId =
    explicitUserId ??
    firstString(selected, ["user_id", "uid", "account_id"]) ??
    firstString(parseJsonObject(body) ?? {}, ["uid", "user_id"]) ??
    firstString(parseJsonObject((parseJsonObject(body) ?? {}).data) ?? {}, ["uid", "user_id"]) ??
    detectUserIdFromAnyPayload(body) ??
    extractUserIdFromToken(token);

  if (!serial) throw new Error("Serial da impressora não encontrado na resposta cloud.");
  if (!userId) throw new Error("User ID da conta não encontrado na resposta cloud.");
  const mqttPasswords = [mqttToken, accessCode, token].filter(
    (value, idx, arr): value is string => !!value && arr.indexOf(value) === idx
  );
  if (mqttPasswords.length === 0) {
    throw new Error("Nenhuma credencial MQTT encontrada (mqtt_token/access_code/token).");
  }

  return { serial, userId, mqttHost, mqttPasswords };
}

function cloudApiBase(region: BambuCloudRegion): string {
  return region === "china" ? "https://api.bambulab.cn" : "https://api.bambulab.com";
}

function normalizeRegion(raw?: string): BambuCloudRegion {
  return raw === "china" ? "china" : "global";
}

export async function startBambuCloudLogin(options: {
  account: string;
  password: string;
  region?: string;
}): Promise<{ loginType: "token" | "verifyCode"; accessToken?: string }> {
  const account = options.account.trim();
  const password = options.password;
  const region = normalizeRegion(options.region);
  if (!account) throw new Error("Conta (email) é obrigatória.");
  if (!password) throw new Error("Password é obrigatória.");

  const response = await fetch(`${cloudApiBase(region)}/v1/user-service/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account,
      password,
      apiError: "",
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha no login cloud (${response.status}).`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const token =
    typeof body.accessToken === "string" && body.accessToken.trim()
      ? body.accessToken.trim()
      : null;
  if (token) return { loginType: "token", accessToken: token };

  const loginType =
    typeof body.loginType === "string" && body.loginType === "verifyCode"
      ? "verifyCode"
      : null;
  if (loginType === "verifyCode") {
    return { loginType };
  }

  throw new Error("Resposta de login inesperada da Bambu Cloud.");
}

export async function sendBambuCloudEmailCode(options: {
  account: string;
  region?: string;
}): Promise<void> {
  const account = options.account.trim();
  const region = normalizeRegion(options.region);
  if (!account) throw new Error("Conta (email) é obrigatória.");

  const response = await fetch(`${cloudApiBase(region)}/v1/user-service/user/sendemail/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: account,
      type: "codeLogin",
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao enviar código por email (${response.status}).`);
  }
}

export async function verifyBambuCloudEmailCode(options: {
  account: string;
  code: string;
  region?: string;
}): Promise<{ accessToken: string }> {
  const account = options.account.trim();
  const code = options.code.trim();
  const region = normalizeRegion(options.region);
  if (!account) throw new Error("Conta (email) é obrigatória.");
  if (!code) throw new Error("Código é obrigatório.");

  const response = await fetch(`${cloudApiBase(region)}/v1/user-service/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao validar código (${response.status}).`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const token =
    typeof body.accessToken === "string" && body.accessToken.trim()
      ? body.accessToken.trim()
      : null;
  if (!token) throw new Error("Token não recebido após validar código.");
  return { accessToken: token };
}

export async function getBambuCloudWhoAmI(options: {
  token: string;
  region?: string;
}): Promise<{
  userId: string | null;
  tokenUserId: string | null;
  profileUserId: string | null;
}> {
  const token = options.token.trim();
  const region = normalizeRegion(options.region);
  if (!token) throw new Error("Token é obrigatório.");

  const tokenUserId = extractUserIdFromToken(token);
  let profileUserId: string | null = null;
  let bindUserId: string | null = null;

  try {
    const response = await fetch(`${cloudApiBase(region)}/v1/user-service/my/profile`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (response.ok) {
      const body = (await response.json()) as unknown;
      const root = parseJsonObject(body) ?? {};
      const data = parseJsonObject(root.data) ?? {};
      profileUserId =
        firstString(root, ["uid", "user_id", "id", "account_id"]) ??
        firstString(data, ["uid", "user_id", "id", "account_id"]) ??
        detectUserIdFromAnyPayload(body);
    }
  } catch {
    // ignore profile lookup errors; token payload may still provide userId
  }

  try {
    const bindResponse = await fetch(`${cloudApiBase(region)}/v1/iot-service/api/user/bind`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (bindResponse.ok) {
      const bindBody = (await bindResponse.json()) as unknown;
      bindUserId = detectUserIdFromAnyPayload(bindBody);
    }
  } catch {
    // ignore bind lookup errors
  }

  return {
    userId: profileUserId ?? bindUserId ?? tokenUserId,
    tokenUserId,
    profileUserId: profileUserId ?? bindUserId,
  };
}

function collectCandidateIdFields(
  input: unknown,
  depth = 0,
  path = "root",
  out: Array<{ path: string; key: string; value: string }> = []
): Array<{ path: string; key: string; value: string }> {
  if (depth > 8 || !input || typeof input !== "object") return out;
  const obj = input as Record<string, unknown>;
  const candidateKeys = new Set([
    "uid",
    "user_id",
    "userId",
    "account_id",
    "accountId",
    "owner_id",
    "ownerId",
    "id",
    "sub",
    "dev_id",
    "serial",
    "deviceId",
    "device_id",
  ]);

  for (const [k, v] of Object.entries(obj)) {
    if (candidateKeys.has(k)) {
      if (typeof v === "string" && v.trim()) {
        out.push({ path, key: k, value: v.trim() });
      } else if (typeof v === "number" && Number.isFinite(v)) {
        out.push({ path, key: k, value: String(v) });
      }
    }
  }

  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      collectCandidateIdFields(v, depth + 1, `${path}.${k}`, out);
    }
  }
  return out;
}

export async function getBambuCloudDebugIdentity(options: {
  token: string;
  region?: string;
}): Promise<{
  tokenUserId: string | null;
  profileCandidates: Array<{ path: string; key: string; value: string }>;
  bindCandidates: Array<{ path: string; key: string; value: string }>;
}> {
  const token = options.token.trim();
  const region = normalizeRegion(options.region);
  if (!token) throw new Error("Token é obrigatório.");

  const tokenUserId = extractUserIdFromToken(token);
  let profileCandidates: Array<{ path: string; key: string; value: string }> = [];
  let bindCandidates: Array<{ path: string; key: string; value: string }> = [];

  try {
    const profileResponse = await fetch(`${cloudApiBase(region)}/v1/user-service/my/profile`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (profileResponse.ok) {
      const profileBody = (await profileResponse.json()) as unknown;
      profileCandidates = collectCandidateIdFields(profileBody);
    }
  } catch {
    // ignore
  }

  try {
    const bindResponse = await fetch(`${cloudApiBase(region)}/v1/iot-service/api/user/bind`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (bindResponse.ok) {
      const bindBody = (await bindResponse.json()) as unknown;
      bindCandidates = collectCandidateIdFields(bindBody);
    }
  } catch {
    // ignore
  }

  return {
    tokenUserId,
    profileCandidates,
    bindCandidates,
  };
}

async function connectToMqtt(
  clientOptions: IClientOptions,
  serial: string,
  source: "local" | "cloud"
): Promise<void> {
  disconnectBambu();
  state.connecting = true;
  state.lastError = null;

  const topic = `device/${serial}/report`;
  const mqtt = connect(clientOptions);
  client = mqtt;
  activeTopic = topic;
  state.topic = topic;
  state.source = source;

  mqtt.on("connect", () => {
    if (client !== mqtt) return;
    state.connecting = false;
    state.connected = true;
    state.lastError = null;
    mqtt.subscribe(topic, { qos: 0 }, (err) => {
      if (client !== mqtt) return;
      if (err) state.lastError = `Falha ao subscrever tópico: ${err.message}`;
    });
  });

  mqtt.on("message", (_topic, payloadBuffer) => {
    if (client !== mqtt) return;
    state.lastRawReportAt = new Date().toISOString();
    try {
      const text = payloadBuffer.toString("utf-8");
      const parsed = JSON.parse(text) as unknown;
      const { current, total } = detectLayerInfo(parsed);
      applyLayerUpdate(current, total);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      state.lastError = `Payload MQTT inválido: ${message}`;
    }
  });

  mqtt.on("error", (err) => {
    if (client !== mqtt) return;
    state.lastError = err.message;
  });

  mqtt.on("close", () => {
    if (client !== mqtt) return;
    resetConnectionState();
  });

  mqtt.on("offline", () => {
    if (client !== mqtt) return;
    state.connected = false;
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout na conexão com a Bambu."));
    }, 15_000);

    mqtt.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });

    mqtt.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function connectBambuCloud(
  options: Partial<BambuCloudConnectOptions>
): Promise<void> {
  if (state.connecting) throw new Error("Ligação à Bambu já em progresso.");
  const token = resolveOption(options.token, process.env.BAMBU_CLOUD_TOKEN);
  const serial = resolveOption(options.serial, process.env.BAMBU_SERIAL);
  const userId = resolveOption(options.userId, process.env.BAMBU_CLOUD_USER_ID);
  const regionRaw = resolveOption(options.region, process.env.BAMBU_CLOUD_REGION, "global");
  const region = normalizeRegion(regionRaw);
  const rejectUnauthorized =
    options.rejectUnauthorized ??
    (process.env.BAMBU_TLS_REJECT_UNAUTHORIZED ?? "false").toLowerCase() === "true";
  if (!token) throw new Error("BAMBU_CLOUD_TOKEN não definido.");

  const cloudDevice = await fetchCloudDeviceInfo(
    token,
    serial || undefined,
    region,
    userId || undefined
  );
  const usernameCandidates = [`u_${cloudDevice.userId}`, cloudDevice.userId];
  const protocol: "mqtts" = "mqtts";
  const port = 8883;

  state.host = cloudDevice.mqttHost;
  state.port = port;
  state.serial = cloudDevice.serial;
  let lastErr: string | null = null;
  const attempts: string[] = [];
  const passwordCandidates = cloudDevice.mqttPasswords;

  for (const username of usernameCandidates) {
    for (const password of passwordCandidates) {
      const passwordLabel =
        password === token
          ? "token"
          : password.length > 20
          ? "mqtt_token"
          : "access_code";
      attempts.push(`${username}/${passwordLabel}`);
      try {
        await connectToMqtt(
          {
            protocol,
            host: cloudDevice.mqttHost,
            port,
            username,
            password,
            reconnectPeriod: 5000,
            connectTimeout: 15_000,
            rejectUnauthorized,
          },
          cloudDevice.serial,
          "cloud"
        );
        return;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        lastErr = `${username}/${passwordLabel}: ${message}`;
        disconnectBambu();
      }
    }
  }

  throw new Error(
    `Falha na autenticação MQTT cloud (tentativas: ${attempts.join(
      ", "
    )}). Último erro: ${lastErr ?? "desconhecido"}`
  );
}

export function disconnectBambu(): void {
  if (client) {
    try {
      if (activeTopic) client.unsubscribe(activeTopic);
      client.end(true);
    } catch {
      // ignore
    }
  }
  client = null;
  activeTopic = null;
  resetConnectionState();
}

export function getBambuStatus(): BambuState {
  return {
    ...state,
    recentLayerEvents: [...state.recentLayerEvents],
  };
}

export function onBambuLayerCompleted(
  listener: (event: LayerCompletedEvent) => void | Promise<void>
): () => void {
  layerCompletedListeners.add(listener);
  return () => {
    layerCompletedListeners.delete(listener);
  };
}
