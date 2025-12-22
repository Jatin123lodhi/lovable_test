import express from "express";
import { PORT } from "./config";
import { handleAgent } from "./routes/agent";
import { handleStreamAgent } from "./routes/stream-agent";
import { handleStreamDummy } from "./routes/stream-dummy";
import { handleSandbox } from "./routes/sandbox";

const app = express();
app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.json('Backend running...');
});

// API routes
app.post("/agent", handleAgent);
app.post("/stream-agent", handleStreamAgent);
app.post("/stream-dummy", handleStreamDummy);
app.post("/sandbox", handleSandbox);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
