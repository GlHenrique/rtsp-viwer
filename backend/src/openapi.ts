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
      { name: "Bambu", description: "Monitoramento de impressão Bambu por camada" },
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
        BambuConnectRequest: {
          type: "object",
          properties: {
            host: { type: "string", example: "192.168.1.50" },
            serial: { type: "string", example: "01S00A123400123" },
            accessCode: { type: "string", example: "12345678" },
            username: { type: "string", example: "bblp" },
            port: { type: "integer", example: 8883, minimum: 1 },
            protocol: { type: "string", enum: ["mqtt", "mqtts"], example: "mqtts" },
            rejectUnauthorized: { type: "boolean", example: false },
          },
        },
        BambuCloudConnectRequest: {
          type: "object",
          properties: {
            token: { type: "string", description: "Bearer token da Bambu Cloud" },
            serial: { type: "string", example: "01S00A123400123" },
            userId: { type: "string", example: "123456789", description: "User ID da conta Bambu (opcional, fallback manual)" },
            region: { type: "string", enum: ["global", "china"], example: "global" },
            rejectUnauthorized: { type: "boolean", example: false },
          },
        },
        BambuWebhookRequest: {
          type: "object",
          properties: {
            url: {
              type: "string",
              nullable: true,
              example: "https://example.com/hooks/bambu-layer",
            },
            enabled: { type: "boolean", example: true },
          },
        },
        BambuCloudAuthStartRequest: {
          type: "object",
          properties: {
            account: { type: "string", example: "seu-email@dominio.com" },
            password: { type: "string", example: "sua-password" },
            region: { type: "string", enum: ["global", "china"], example: "global" },
          },
          required: ["account", "password"],
        },
        BambuCloudAuthVerifyRequest: {
          type: "object",
          properties: {
            account: { type: "string", example: "seu-email@dominio.com" },
            code: { type: "string", example: "123456" },
            region: { type: "string", enum: ["global", "china"], example: "global" },
          },
          required: ["account", "code"],
        },
        BambuCloudWhoAmIRequest: {
          type: "object",
          properties: {
            token: { type: "string", description: "Bearer token da Bambu Cloud" },
            region: { type: "string", enum: ["global", "china"], example: "global" },
          },
          required: ["token"],
        },
        BambuCloudDebugIdentityRequest: {
          type: "object",
          properties: {
            token: { type: "string", description: "Bearer token da Bambu Cloud" },
            region: { type: "string", enum: ["global", "china"], example: "global" },
          },
          required: ["token"],
        },
        BambuLayerEvent: {
          type: "object",
          properties: {
            layer: { type: "integer", example: 12 },
            previousLayer: { type: "integer", nullable: true, example: 11 },
            at: { type: "string", format: "date-time" },
          },
          required: ["layer", "previousLayer", "at"],
        },
        BambuStatus: {
          type: "object",
          properties: {
            connected: { type: "boolean", example: true },
            connecting: { type: "boolean", example: false },
            host: { type: "string", nullable: true, example: "192.168.1.50" },
            port: { type: "integer", nullable: true, example: 8883 },
            serial: { type: "string", nullable: true, example: "01S00A123400123" },
            topic: { type: "string", nullable: true, example: "device/01S00A123400123/report" },
            source: { type: "string", nullable: true, enum: ["local", "cloud"], example: "cloud" },
            lastError: { type: "string", nullable: true, example: null },
            lastRawReportAt: { type: "string", format: "date-time", nullable: true, example: null },
            lastLayer: { type: "integer", nullable: true, example: 12 },
            lastLayerCompletedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-04-21T18:30:00.000Z",
            },
            totalLayers: { type: "integer", nullable: true, example: 150 },
            recentLayerEvents: {
              type: "array",
              items: { $ref: "#/components/schemas/BambuLayerEvent" },
            },
            webhookUrl: { type: "string", nullable: true, example: "https://example.com/hooks/bambu-layer" },
            webhookEnabled: { type: "boolean", example: true },
            lastWebhookAt: {
              type: "string",
              format: "date-time",
              nullable: true,
              example: "2026-04-21T18:40:00.000Z",
            },
            lastWebhookStatus: { type: "integer", nullable: true, example: 200 },
            lastWebhookError: { type: "string", nullable: true, example: null },
          },
          required: [
            "connected",
            "connecting",
            "host",
            "port",
            "serial",
            "topic",
            "source",
            "lastError",
            "lastRawReportAt",
            "lastLayer",
            "lastLayerCompletedAt",
            "totalLayers",
            "recentLayerEvents",
            "webhookUrl",
            "webhookEnabled",
            "lastWebhookAt",
            "lastWebhookStatus",
            "lastWebhookError",
          ],
        },
        BambuConnectResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            status: { $ref: "#/components/schemas/BambuStatus" },
          },
          required: ["ok", "status"],
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
      "/api/bambu/status": {
        get: {
          tags: ["Bambu"],
          summary: "Consulta estado atual da conexão e camadas da Bambu",
          responses: {
            200: {
              description: "Estado do monitoramento Bambu",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BambuStatus" },
                },
              },
            },
          },
        },
      },
      "/api/bambu/connect": {
        post: {
          tags: ["Bambu"],
          summary: "Conecta ao MQTT da Bambu e inicia detecção por camada",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BambuConnectRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Conectado com sucesso",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BambuConnectResponse" },
                },
              },
            },
            400: {
              description: "Configuração inválida ou falha de conexão",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/bambu/disconnect": {
        post: {
          tags: ["Bambu"],
          summary: "Desconecta o monitoramento da Bambu",
          responses: {
            200: {
              description: "Desconectado com sucesso",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BambuConnectResponse" },
                },
              },
            },
          },
        },
      },
      "/api/bambu/connect-cloud": {
        post: {
          tags: ["Bambu"],
          summary: "Conecta via Bambu Cloud (mantendo cloud ativo)",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BambuCloudConnectRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Conectado com sucesso via cloud",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BambuConnectResponse" },
                },
              },
            },
            400: {
              description: "Token inválido, serial inválido ou erro de conexão",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/bambu/webhook": {
        post: {
          tags: ["Bambu"],
          summary: "Configura webhook para evento de fim de camada",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BambuWebhookRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Webhook configurado",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      webhookUrl: { type: "string", nullable: true },
                      webhookEnabled: { type: "boolean", example: true },
                      status: { $ref: "#/components/schemas/BambuStatus" },
                    },
                    required: ["ok", "webhookUrl", "webhookEnabled", "status"],
                  },
                },
              },
            },
            400: {
              description: "Payload inválido",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/bambu/cloud-auth/start": {
        post: {
          tags: ["Bambu"],
          summary: "Inicia login cloud (email/password) para obter token",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BambuCloudAuthStartRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Login iniciado com sucesso",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      loginType: { type: "string", enum: ["token", "verifyCode"] },
                      message: { type: "string", nullable: true },
                      accessToken: { type: "string", nullable: true },
                    },
                    required: ["ok", "loginType"],
                  },
                },
              },
            },
            400: {
              description: "Erro de autenticação",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/bambu/cloud-auth/verify": {
        post: {
          tags: ["Bambu"],
          summary: "Valida código de email e retorna Bearer token",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BambuCloudAuthVerifyRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Código validado com sucesso",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      accessToken: { type: "string" },
                    },
                    required: ["ok", "accessToken"],
                  },
                },
              },
            },
            400: {
              description: "Código inválido ou expirado",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/bambu/cloud-auth/whoami": {
        post: {
          tags: ["Bambu"],
          summary: "Retorna userId detectado a partir do token cloud",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BambuCloudWhoAmIRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Detecção de identidade cloud",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      userId: { type: "string", nullable: true },
                      tokenUserId: { type: "string", nullable: true },
                      profileUserId: { type: "string", nullable: true },
                    },
                    required: ["ok", "userId", "tokenUserId", "profileUserId"],
                  },
                },
              },
            },
            400: {
              description: "Token inválido ou erro de consulta",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/bambu/cloud-auth/debug-identity": {
        post: {
          tags: ["Bambu"],
          summary: "Debug de campos de identidade retornados pela cloud",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BambuCloudDebugIdentityRequest" },
              },
            },
          },
          responses: {
            200: {
              description: "Campos candidatos detectados",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      tokenUserId: { type: "string", nullable: true },
                      profileCandidates: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            path: { type: "string" },
                            key: { type: "string" },
                            value: { type: "string" },
                          },
                          required: ["path", "key", "value"],
                        },
                      },
                      bindCandidates: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            path: { type: "string" },
                            key: { type: "string" },
                            value: { type: "string" },
                          },
                          required: ["path", "key", "value"],
                        },
                      },
                    },
                    required: ["ok", "tokenUserId", "profileCandidates", "bindCandidates"],
                  },
                },
              },
            },
            400: {
              description: "Token inválido ou erro de consulta",
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
