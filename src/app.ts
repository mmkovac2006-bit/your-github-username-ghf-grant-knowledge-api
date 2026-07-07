import express from "express";
import { createDebugRouter } from "./routes/debug";
import { createHealthRouter } from "./routes/health";
import { createSearchRouter } from "./routes/search";
import { DropboxRepository } from "./services/dropboxRepository";
import { GrantSearchService } from "./services/grantSearchService";
import { PostgresRepository } from "./services/postgresRepository";
import type { SourceRepository } from "./types/search";
import { createConfig, type AppConfig } from "./utils/config";
import { errorHandler } from "./utils/errors";
import { requireApiKey } from "./middleware/auth";
import { basicRateLimit } from "./middleware/rateLimit";
import { requestLogger } from "./middleware/requestLogger";
import { requestTimeout } from "./middleware/requestTimeout";

export type CreateAppOptions = {
  config?: AppConfig;
  sourceRepository?: SourceRepository;
};

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? createConfig();
  const sourceRepository = options.sourceRepository ?? createSourceRepository(config);
  const searchService = new GrantSearchService(sourceRepository, config);
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(requestTimeout(config));
  app.use(requestLogger(config));

  app.use(createHealthRouter());

  const protectedRouter = express.Router();
  protectedRouter.use(basicRateLimit());
  protectedRouter.use(requireApiKey(config));
  protectedRouter.use(createDebugRouter(config, sourceRepository));
  protectedRouter.use(createSearchRouter(searchService));
  app.use(protectedRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: "not_found",
      message: "Endpoint not found."
    });
  });

  app.use(errorHandler);

  return app;
}

function createSourceRepository(config: AppConfig): SourceRepository {
  if (config.searchBackend === "database" && config.databaseUrl) {
    return new PostgresRepository(config);
  }

  return new DropboxRepository(config);
}

export default createApp();
