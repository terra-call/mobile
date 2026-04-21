import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { startNotificationScheduler } from "./lib/notificationScheduler";

const app: Express = express();

// Resolve the public dir for both dev (src/../public) and prod (dist/../public)
const here = path.dirname(fileURLToPath(import.meta.url));
const candidatePublic = [
  path.resolve(here, "..", "public"),
  path.resolve(here, "..", "..", "public"),
];
const publicDir = candidatePublic.find((p) => existsSync(p));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Static legal docs — accessible at /legal/privacy and /legal/terms (no .html)
if (publicDir) {
  app.get("/legal/privacy", (_req, res) => {
    res.sendFile(path.join(publicDir, "legal", "privacy.html"));
  });
  app.get("/legal/terms", (_req, res) => {
    res.sendFile(path.join(publicDir, "legal", "terms.html"));
  });
  // Also serve the raw .html paths and any other future static assets
  app.use(express.static(publicDir, { extensions: ["html"] }));
} else {
  logger.warn("public/ directory not found — /legal routes disabled");
}

export default app;
