import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Hls from 'hls.js'
import './App.css'

const PLAYLIST = '/hls/stream.m3u8'

/**
 * HLS live (FFmpeg, não LL-HLS): `lowLatencyMode` false.
 * Equilíbrio: perto da borda ao vivo sem underrun (buffer minúsculo + lista curta no
 * servidor causava ciclo: ~10s a tocar → segmentos 404 / buffer vazio → ~10s a recuperar).
 */
const HLS_PLAYER_CONFIG: Partial<Hls['config']> = {
  enableWorker: true,
  lowLatencyMode: false,
  liveSyncMode: 'buffered',
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 10,
  maxLiveSyncPlaybackRate: 1.35,
  maxBufferLength: 22,
  maxMaxBufferLength: 50,
  maxBufferHole: 0.5,
  maxFragLookUpTolerance: 0.35,
  nudgeMaxRetry: 10,
  backBufferLength: 45,
  liveDurationInfinity: true,
  initialLiveManifestSize: 2,
}

const ATTEMPT_TIMEOUT_MS = 45_000

type OnvifStreamRow = {
  profileToken: string
  name: string
  uri: string
  rtspUrl: string
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const startCancelRef = useRef(false)
  const startAbortRef = useRef<AbortController | null>(null)
  const [url, setUrl] = useState('')
  const [running, setRunning] = useState(false)
  /** `none`: sem `<video>`; `loading`: montado mas fora do ecrã até o HLS estar pronto; `ready`: visível. */
  const [playerPhase, setPlayerPhase] = useState<'none' | 'loading' | 'ready'>(
    'none'
  )
  const [loading, setLoading] = useState(false)
  const [loadingHint, setLoadingHint] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [onvifHost, setOnvifHost] = useState('')
  const [onvifPort, setOnvifPort] = useState('2020')
  const [onvifUser, setOnvifUser] = useState('')
  const [onvifPass, setOnvifPass] = useState('')
  const [onvifPath, setOnvifPath] = useState('')
  const [onvifLoading, setOnvifLoading] = useState(false)
  const [onvifStreams, setOnvifStreams] = useState<OnvifStreamRow[] | null>(
    null
  )
  const [onvifPickToken, setOnvifPickToken] = useState('')

  const detachPlayer = useCallback(() => {
    hlsRef.current?.destroy()
    hlsRef.current = null
    const v = videoRef.current
    if (v) {
      v.removeAttribute('src')
      v.load()
    }
  }, [])

  const loadHlsPlaylist = useCallback((): Promise<void> => {
    const video = videoRef.current
    if (!video) {
      return Promise.reject(new Error('Elemento de vídeo indisponível.'))
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        detachPlayer()
        reject(new Error('Tempo esgotado ao carregar o manifest HLS.'))
      }, ATTEMPT_TIMEOUT_MS)

      function cleanup() {
        clearTimeout(timeout)
      }

      function onFatalHls(data: { details?: string; type?: string }) {
        cleanup()
        hlsRef.current?.destroy()
        hlsRef.current = null
        reject(new Error(data.details ?? data.type ?? 'Erro HLS'))
      }

      if (Hls.isSupported()) {
        const hls = new Hls(HLS_PLAYER_CONFIG)
        hlsRef.current = hls

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          cleanup()
          void video.play().catch(() => {
            /* autoplay pode ser bloqueado */
          })
          resolve()
        })

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError()
            return
          }
          onFatalHls(data)
        })

        hls.loadSource(PLAYLIST)
        hls.attachMedia(video)
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = PLAYLIST
        const onOk = () => {
          cleanup()
          void video.play().catch(() => {})
          resolve()
        }
        const onErr = () => {
          cleanup()
          reject(new Error('Erro ao carregar HLS nativo.'))
        }
        video.addEventListener('loadedmetadata', onOk, { once: true })
        video.addEventListener('error', onErr, { once: true })
      } else {
        cleanup()
        reject(new Error('Este navegador não suporta HLS.'))
      }
    })
  }, [detachPlayer])

  const handleStart = async () => {
    setMessage(null)
    setLoadingHint(null)
    setLoading(true)
    startCancelRef.current = false
    startAbortRef.current?.abort()
    const ac = new AbortController()
    startAbortRef.current = ac
    detachPlayer()
    setPlayerPhase('none')

    try {
      const trimmed = url.trim()
      setLoadingHint(
        'A preparar o stream no servidor (RTSP → HLS). Pode demorar até o FFmpeg gerar a playlist…'
      )
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trimmed ? { url: trimmed } : {}),
        signal: ac.signal,
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
      }
      if (!res.ok) {
        setMessage(
          typeof data.error === 'string'
            ? data.error
            : 'Não foi possível iniciar o stream.'
        )
        setRunning(false)
        setPlayerPhase('none')
        return
      }

      if (startCancelRef.current) {
        setRunning(false)
        setPlayerPhase('none')
        return
      }

      flushSync(() => {
        setRunning(true)
        setPlayerPhase('loading')
      })
      setLoadingHint('A carregar o vídeo…')

      try {
        await loadHlsPlaylist()
        setPlayerPhase('ready')
        setMessage(null)
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : 'Falha ao reproduzir o stream.'
        setMessage(msg)
        setRunning(false)
        setPlayerPhase('none')
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setRunning(false)
        setPlayerPhase('none')
        return
      }
      setMessage('Não foi possível contactar o servidor (backend em execução?).')
      setRunning(false)
      setPlayerPhase('none')
    } finally {
      startAbortRef.current = null
      setLoading(false)
      setLoadingHint(null)
    }
  }

  const handleStop = async () => {
    startCancelRef.current = true
    startAbortRef.current?.abort()
    setLoading(true)
    try {
      await fetch('/api/stream/stop', { method: 'POST' })
    } finally {
      detachPlayer()
      setRunning(false)
      setPlayerPhase('none')
      setLoading(false)
      setLoadingHint(null)
      setMessage(null)
    }
  }

  useEffect(() => {
    return () => {
      startCancelRef.current = true
      detachPlayer()
    }
  }, [detachPlayer])

  useEffect(() => {
    if (!onvifStreams?.length) return
    const row =
      onvifStreams.find((s) => s.profileToken === onvifPickToken) ??
      onvifStreams[0]
    if (row) setUrl(row.rtspUrl)
  }, [onvifStreams, onvifPickToken])

  const handleOnvifFetch = async () => {
    setMessage(null)
    setOnvifLoading(true)
    setOnvifStreams(null)
    try {
      const portNum = Number(onvifPort)
      const res = await fetch('/api/onvif/rtsp-streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname: onvifHost.trim(),
          username: onvifUser,
          password: onvifPass,
          ...(Number.isFinite(portNum) && portNum > 0
            ? { port: portNum }
            : {}),
          ...(onvifPath.trim() ? { path: onvifPath.trim() } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        streams?: OnvifStreamRow[]
      }
      if (!res.ok) {
        setMessage(
          typeof data.error === 'string'
            ? data.error
            : 'Falha ao consultar ONVIF.'
        )
        return
      }
      const streams = data.streams ?? []
      if (!streams.length) {
        setMessage('O dispositivo não devolveu perfis RTSP.')
        return
      }
      setOnvifStreams(streams)
      setOnvifPickToken(streams[0].profileToken)
    } catch {
      setMessage('Não foi possível contactar o servidor.')
    } finally {
      setOnvifLoading(false)
    }
  }

  return (
    <div className="viewer">
      <header className="viewer-header">
        <h1>RTSP — câmara</h1>
        <p className="viewer-lead">
          O servidor lê o fluxo RTSP e converte para HLS para o navegador
          reproduzir. Câmaras com{' '}
          <strong>ONVIF</strong> podem obter o URL RTSP automaticamente (serviço
          de média). É necessário ter{' '}
          <a
            href="https://ffmpeg.org/download.html"
            target="_blank"
            rel="noreferrer"
          >
            FFmpeg
          </a>{' '}
          instalado e acessível no PATH.
        </p>
      </header>

      <div className="panel">
        <label className="field">
          <span>URL RTSP</span>
          <div className="url-inline">
            <input
              type="url"
              name="rtsp"
              autoComplete="off"
              spellCheck={false}
              placeholder="rtsp://utilizador:password@192.168.1.100:554/stream"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !running && !loading) {
                  e.preventDefault()
                  void handleStart()
                }
              }}
              disabled={running || loading}
            />
            <button
              type="button"
              className="btn primary url-inline-submit"
              onClick={() => void handleStart()}
              disabled={running || loading}
            >
              {loading && !running ? 'A iniciar…' : 'Iniciar stream'}
            </button>
          </div>
        </label>
        <p className="hint stream-source-hint">
          Se ficar vazio, usa <code>RTSP_URL</code> no <code>.env</code> do
          backend ou o URL obtido pelo ONVIF (secção abaixo).
        </p>

        <div className="onvif-block">
          <h2 className="onvif-title">ONVIF</h2>
          <p className="hint onvif-intro">
            Porta predefinida <strong>2020</strong>; outras comuns:{' '}
            <strong>80</strong> ou <strong>8080</strong> (consulte o manual). As
            credenciais são
            enviadas ao servidor para pedir o URL RTSP ao dispositivo.
          </p>
          <div className="onvif-grid">
            <label className="field">
              <span>IP / hostname</span>
              <input
                type="text"
                name="onvifHost"
                autoComplete="off"
                spellCheck={false}
                placeholder="192.168.1.100"
                value={onvifHost}
                onChange={(e) => setOnvifHost(e.target.value)}
                disabled={running || loading || onvifLoading}
              />
            </label>
            <label className="field">
              <span>Porta ONVIF</span>
              <input
                type="number"
                name="onvifPort"
                min={1}
                max={65535}
                placeholder="2020"
                value={onvifPort}
                onChange={(e) => setOnvifPort(e.target.value)}
                disabled={running || loading || onvifLoading}
              />
            </label>
            <label className="field">
              <span>Utilizador</span>
              <input
                type="text"
                name="onvifUser"
                autoComplete="username"
                value={onvifUser}
                onChange={(e) => setOnvifUser(e.target.value)}
                disabled={running || loading || onvifLoading}
              />
            </label>
            <label className="field">
              <span>Palavra-passe</span>
              <input
                type="password"
                name="onvifPass"
                autoComplete="current-password"
                value={onvifPass}
                onChange={(e) => setOnvifPass(e.target.value)}
                disabled={running || loading || onvifLoading}
              />
            </label>
            <label className="field onvif-span-2">
              <span>Path do serviço (opcional)</span>
              <input
                type="text"
                name="onvifPath"
                autoComplete="off"
                spellCheck={false}
                placeholder="/onvif/device_service — só se o manual indicar"
                value={onvifPath}
                onChange={(e) => setOnvifPath(e.target.value)}
                disabled={running || loading || onvifLoading}
              />
            </label>
          </div>
          <div className="actions onvif-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void handleOnvifFetch()}
              disabled={
                running || loading || onvifLoading || !onvifHost.trim()
              }
            >
              {onvifLoading ? 'A consultar ONVIF…' : 'Obter URL RTSP'}
            </button>
          </div>
          {onvifStreams && onvifStreams.length > 1 ? (
            <label className="field onvif-pick">
              <span>Perfil de vídeo</span>
              <select
                value={onvifPickToken}
                onChange={(e) => setOnvifPickToken(e.target.value)}
                disabled={running || loading}
              >
                {onvifStreams.map((s) => (
                  <option key={s.profileToken} value={s.profileToken}>
                    {s.name} ({s.profileToken})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleStart()}
            disabled={running || loading}
          >
            {loading && !running ? 'A iniciar…' : 'Iniciar'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void handleStop()}
            disabled={!running && !loading}
          >
            Parar
          </button>
        </div>

        {loadingHint ? (
          <p className="stream-hint" aria-live="polite">
            {loadingHint}
          </p>
        ) : null}
        {message ? <p className="error" role="alert">{message}</p> : null}
      </div>

      {playerPhase !== 'none' ? (
        <div
          className={
            playerPhase === 'loading'
              ? 'video-wrap video-wrap--preparing'
              : 'video-wrap'
          }
        >
          <video
            ref={videoRef}
            className="video"
            controls
            playsInline
            muted
          />
        </div>
      ) : null}
    </div>
  )
}

export default App
