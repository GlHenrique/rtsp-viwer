<p align="center">
  <img src="frontend/src/assets/hero.png" alt="RTSP Viewer" width="120" />
</p>

<h1 align="center">RTSP Viewer</h1>

<p align="center">
  <strong>Browser-based RTSP stream viewer via HLS with automatic ONVIF camera discovery</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/FFmpeg-007808?logo=ffmpeg&logoColor=white" alt="FFmpeg" />
  <img src="https://img.shields.io/badge/HLS.js-1.6-orange" alt="HLS.js" />
  <img src="https://img.shields.io/badge/ONVIF-0.8-blue" alt="ONVIF" />
  <img src="https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
</p>

---

## About

**RTSP Viewer** converts RTSP streams from IP cameras into HLS (HTTP Live Streaming) for playback directly in the browser, with low latency and automatic camera discovery via the ONVIF protocol.

## Features

- **Live streaming** — Real-time RTSP camera playback in the browser
- **Low latency** — Aggressive HLS configuration with automatic latency compensation
- **ONVIF discovery** — Detects and lists available stream profiles from the camera
- **Multi-profile** — Choose between main stream, substreams, and other camera profiles
- **Modern interface** — Responsive UI with dark mode support
- **Simple controls** — Start/Stop with visual status and error feedback

## Architecture

```
┌──────────────┐    RTSP     ┌──────────────┐    HLS     ┌──────────────┐
│  IP Camera   │ ──────────> │   Backend    │ ────────> │   Frontend   │
│  (ONVIF)     │             │  Express +   │  .m3u8 +  │  React +     │
│              │             │  FFmpeg      │  .ts      │  HLS.js      │
└──────────────┘             └──────────────┘           └──────────────┘
```

## Tech Stack

| Layer | Technology | Version | Description |
|-------|-----------|---------|-------------|
| **Frontend** | React | 19 | UI library with hooks |
| | TypeScript | ~6.0 | Static typing |
| | Vite | 8 | Build tool and dev server |
| | HLS.js | 1.6 | Adaptive HLS player |
| | ESLint | 9 | Code linting |
| **Backend** | Node.js | — | JavaScript runtime |
| | Express | 4 | HTTP framework |
| | TypeScript | 5 | Static typing |
| | ONVIF | 0.8 | Camera discovery |
| | FFmpeg | — | RTSP to HLS transcoding |
| | dotenv | 17 | Environment variables |
| **Tooling** | pnpm | — | Package manager |
| | tsx | 4 | TypeScript runner (dev) |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) — package manager
- [FFmpeg](https://ffmpeg.org/) — must be available in the system `PATH`

### Installing FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu / Debian:**
```bash
sudo apt update && sudo apt install ffmpeg
```

**Windows:**
```bash
choco install ffmpeg
# or download from https://ffmpeg.org/download.html and add to PATH
```

Verify the installation:
```bash
ffmpeg -version
```

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-username/rtsp-viewer.git
cd rtsp-viewer
```

### 2. Install backend dependencies

```bash
cd backend
pnpm install
```

### 3. Configure backend environment variables

```bash
cp .env.example .env
```

Edit the `.env` file:

```env
PORT=3001
RTSP_URL=rtsp://user:password@192.168.1.100:554/stream1
HLS_READY_TIMEOUT_MS=120000
FFMPEG_LOGLEVEL=error
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend server port |
| `RTSP_URL` | — | Default RTSP URL (optional, can be provided via UI) |
| `HLS_READY_TIMEOUT_MS` | `120000` | Timeout (ms) for HLS playlist to become ready |
| `FFMPEG_LOGLEVEL` | `error` | FFmpeg log level (`error`, `warning`, `info`) |

### 4. Install frontend dependencies

```bash
cd ../frontend
pnpm install
```

## Usage

### Development

Open **two terminals**:

**Terminal 1 — Backend:**
```bash
cd backend
pnpm run dev
```

**Terminal 2 — Frontend:**
```bash
cd frontend
pnpm run dev
```

The frontend will be available at `http://localhost:5173` and will automatically proxy `/api` and `/hls` requests to the backend on port `3001`.

### Production

```bash
# Build the backend
cd backend
pnpm run build
pnpm run start

# Build the frontend
cd ../frontend
pnpm run build
pnpm run preview
```

## Using the Application

1. Open `http://localhost:5173` in your browser
2. **Option A — Manual URL:** Paste the RTSP URL in the input field and click **Start Stream**
3. **Option B — ONVIF Discovery:**
   - Fill in the camera's IP, port, username, and password
   - Click **Fetch Streams**
   - Select the desired profile
   - Click **Start Stream**
4. To stop, click **Stop Stream**

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/stream/status` | Stream status (running, lastError) |
| `POST` | `/api/stream/start` | Start RTSP to HLS conversion |
| `POST` | `/api/stream/stop` | Stop the stream |
| `POST` | `/api/onvif/rtsp-streams` | Fetch streams via ONVIF |
| `GET` | `/hls/stream.m3u8` | HLS playlist |
| `GET` | `/hls/segment_*.ts` | Video segments |

## Project Structure

```
rtsp-viewer/
├── backend/
│   ├── src/
│   │   ├── index.ts            # Express server and routes
│   │   ├── streamManager.ts    # FFmpeg and HLS management
│   │   └── onvifService.ts     # ONVIF discovery service
│   ├── hls-cache/              # Generated HLS segments (runtime)
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx            # React entry point
│   │   ├── App.tsx             # Main component + player
│   │   ├── App.css             # Component styles
│   │   └── index.css           # Global styles and CSS variables
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── tsconfig.json
│
└── README.md
```

## License

This project is for personal / private use.
