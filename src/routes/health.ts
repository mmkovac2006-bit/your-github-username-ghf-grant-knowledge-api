import { Router } from "express";

export function createHealthRouter() {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      status: "ok",
      service: "GHF Grant Knowledge API",
      version: "1.0.0"
    });
  });

  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "GHF Grant Knowledge API",
      version: "1.0.0"
    });
  });

  return router;
}
