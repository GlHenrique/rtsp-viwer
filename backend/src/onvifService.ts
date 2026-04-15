import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Cam } = require("onvif/promises") as {
  Cam: new (opts: Record<string, unknown>) => OnvifCam;
};

type OnvifCam = {
  profiles?: unknown[];
  connect: () => Promise<void>;
  getStreamUri: (opts: {
    protocol: string;
    profileToken: string;
  }) => Promise<unknown>;
};

export type OnvifRtspStream = {
  profileToken: string;
  name: string;
  /** URI devolvido pelo dispositivo (muitas vezes sem credenciais). */
  uri: string;
  /** URL RTSP com utilizador e palavra-passe para o FFmpeg. */
  rtspUrl: string;
};

function extractProfileToken(profile: Record<string, unknown>): string {
  const dollar = profile.$ as { token?: string } | undefined;
  if (dollar?.token) return dollar.token;
  if (typeof profile.token === "string") return profile.token;
  throw new Error("Perfil ONVIF sem token.");
}

function profileName(profile: Record<string, unknown>, token: string): string {
  if (typeof profile.name === "string" && profile.name.trim()) return profile.name;
  return token;
}

function extractUri(stream: unknown): string {
  if (typeof stream === "string") return stream;
  if (stream && typeof stream === "object") {
    const o = stream as Record<string, unknown>;
    if (typeof o.uri === "string") return o.uri;
    const mediaUri = o.mediaUri;
    if (mediaUri && typeof mediaUri === "object") {
      const u = (mediaUri as { uri?: string }).uri;
      if (typeof u === "string") return u;
    }
  }
  throw new Error("Resposta GetStreamUri inválida do dispositivo.");
}

function embedRtspCredentials(
  uri: string,
  user: string,
  pass: string
): string {
  try {
    const u = new URL(uri);
    if (u.protocol !== "rtsp:") return uri;
    u.username = user;
    u.password = pass;
    return u.toString();
  } catch {
    return uri.replace("://", `://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`);
  }
}

/**
 * Liga por ONVIF e devolve um URL RTSP por perfil de média (ex.: principal + substream).
 */
export async function fetchOnvifRtspStreams(options: {
  hostname: string;
  port?: number;
  username: string;
  password: string;
  /** Ex.: /onvif/device_service — só se o fabricante exigir */
  path?: string;
}): Promise<OnvifRtspStream[]> {
  const cam = new Cam({
    hostname: options.hostname.trim(),
    port: options.port ?? 80,
    username: options.username,
    password: options.password,
    autoconnect: false,
    ...(options.path ? { path: options.path } : {}),
  });

  await cam.connect();

  const profiles = cam.profiles as Record<string, unknown>[] | undefined;
  if (!profiles?.length) {
    throw new Error(
      "Nenhum perfil de média ONVIF. Verifique IP, porta ONVIF (sou 80 ou 8080) e credenciais."
    );
  }

  const results: OnvifRtspStream[] = [];

  for (const profile of profiles) {
    const profileToken = extractProfileToken(profile);
    const name = profileName(profile, profileToken);
    const raw = await cam.getStreamUri({
      protocol: "RTSP",
      profileToken,
    });
    const uri = extractUri(raw);
    const rtspUrl = embedRtspCredentials(
      uri,
      options.username,
      options.password
    );
    results.push({ profileToken, name, uri, rtspUrl });
  }

  return results;
}
