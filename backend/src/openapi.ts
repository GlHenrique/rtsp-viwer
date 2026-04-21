export function createOpenApiSpec(port: number) {
  return {
    openapi: "3.0.3",
    info: {
      title: "RTSP Viewer Backend API",
      version: "1.0.0",
      description:
        "API para controlar stream RTSP/HLS, capturar snapshots e descobrir URLs RTSP por ONVIF.",
    },
    servers: [{ url: `http://localhost:${port}` }],
    tags: [
      { name: "Health", description: "Verificação de saúde da API" },
      { name: "Stream", description: "Controle de stream RTSP para HLS" },
      { name: "Snapshot", description: "Captura de snapshot do stream RTSP" },
      { name: "ONVIF", description: "Descoberta de perfis RTSP via ONVIF" },
    ],
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
          required: ["error"],
        },
        HealthResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            service: { type: "string", example: "rtsp-viewer-backend" },
          },
          required: ["ok", "service"],
        },
        StreamStatusResponse: {
          type: "object",
          properties: {
            running: { type: "boolean", example: false },
            lastError: { type: "string", nullable: true, example: null },
            playlistPath: { type: "string", example: "/hls/stream.m3u8" },
          },
          required: ["running", "lastError", "playlistPath"],
        },
        StreamStartRequest: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL RTSP (se omitido, usa RTSP_URL do ambiente)",
              example: "rtsp://admin:admin@192.168.1.10:554/stream1",
            },
          },
        },
        StreamStartResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            playlistPath: { type: "string", example: "/hls/stream.m3u8" },
          },
          required: ["ok", "playlistPath"],
        },
        StopStreamResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
          },
          required: ["ok"],
        },
        SnapshotRequest: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL RTSP opcional, também aceita por query string",
              example: "rtsp://admin:admin@192.168.1.10:554/stream1",
            },
          },
        },
        OnvifStreamsRequest: {
          type: "object",
          properties: {
            hostname: { type: "string", example: "192.168.1.10" },
            username: { type: "string", example: "admin" },
            password: { type: "string", example: "12345" },
            port: { type: "integer", example: 80, minimum: 1 },
            path: { type: "string", example: "/onvif/device_service" },
          },
          required: ["hostname", "username"],
        },
        OnvifStreamItem: {
          type: "object",
          properties: {
            profileToken: { type: "string" },
            name: { type: "string" },
            uri: { type: "string" },
            rtspUrl: { type: "string" },
          },
          required: ["profileToken", "name", "uri", "rtspUrl"],
        },
        OnvifStreamsResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            streams: {
              type: "array",
              items: { $ref: "#/components/schemas/OnvifStreamItem" },
            },
          },
          required: ["ok", "streams"],
        },
      },
    },
    paths: {
      "/api/health": {
        get: {
          tags: ["Health"],
          summary: "Verifica se a API está no ar",
          responses: {
            200: {
              description: "Serviço saudável",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
          },
        },
      },
      "/api/stream/status": {
        get: {
          tags: ["Stream"],
          summary: "Consulta o estado atual do FFmpeg/HLS",
          responses: {
            200: {
              description: "Estado do stream",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StreamStatusResponse" },
                },
              },
            },
          },
        },
      },
      "/api/stream/start": {
        post: {
          tags: ["Stream"],
          summary: "Inicia o stream RTSP e gera HLS",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/StreamStartRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Stream iniciado com sucesso",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StreamStartResponse" },
                },
              },
            },
            400: {
              description: "Parâmetros inválidos ou erro de inicialização",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/stream/stop": {
        post: {
          tags: ["Stream"],
          summary: "Para o stream atual",
          responses: {
            200: {
              description: "Stream parado",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StopStreamResponse" },
                },
              },
            },
          },
        },
      },
      "/api/snapshot": {
        get: {
          tags: ["Snapshot"],
          summary: "Captura snapshot (JPEG) via query string",
          parameters: [
            {
              name: "url",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "URL RTSP opcional",
            },
          ],
          responses: {
            200: {
              description: "Imagem JPEG do stream",
              headers: {
                "X-Snapshot-Path": {
                  schema: { type: "string" },
                  description: "Caminho relativo onde a imagem foi gravada",
                },
              },
              content: {
                "image/jpeg": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            400: {
              description: "URL ausente ou inválida",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            502: {
              description: "Falha ao capturar snapshot",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
        post: {
          tags: ["Snapshot"],
          summary: "Captura snapshot (JPEG) via body JSON",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SnapshotRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Imagem JPEG do stream",
              headers: {
                "X-Snapshot-Path": {
                  schema: { type: "string" },
                  description: "Caminho relativo onde a imagem foi gravada",
                },
              },
              content: {
                "image/jpeg": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            400: {
              description: "URL ausente ou inválida",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            502: {
              description: "Falha ao capturar snapshot",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/onvif/rtsp-streams": {
        post: {
          tags: ["ONVIF"],
          summary: "Descobre URLs RTSP dos perfis ONVIF da câmera",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OnvifStreamsRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Perfis RTSP encontrados",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OnvifStreamsResponse" },
                },
              },
            },
            400: {
              description: "Dados inválidos ou falha de conexão ONVIF",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/hls/stream.m3u8": {
        get: {
          tags: ["Stream"],
          summary: "Retorna a playlist HLS principal",
          responses: {
            200: {
              description: "Playlist encontrada",
              content: {
                "application/vnd.apple.mpegurl": {
                  schema: { type: "string" },
                },
              },
            },
            503: {
              description: "Playlist ainda não disponível",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
    },
  } as const;
}
