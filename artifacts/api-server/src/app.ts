import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkProxyMiddleware, CLERK_PROXY_PATH } from "./middlewares/clerkProxyMiddleware";
import { requireSameOrigin, requireUser } from "./middlewares/security";

const app: Express = express();

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
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
if (process.env.CLERK_SECRET_KEY) {
  app.use(clerkMiddleware());
}
app.use(cors({ origin: true, credentials: true }));
app.use(requireSameOrigin);
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use("/api", requireUser);
app.use("/api", router);

export default app;
