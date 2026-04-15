import cors from "cors";
import express from "express";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "rtsp-viewer-backend" });
});

app.listen(PORT, () => {
  console.log(`API em http://localhost:${PORT}`);
});
