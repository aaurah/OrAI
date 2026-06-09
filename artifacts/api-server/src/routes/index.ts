import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import filesRouter from "./files";
import deploymentsRouter from "./deployments";
import dnsRouter from "./dns";
import aiRouter from "./ai";
import templatesRouter from "./templates";
import githubRouter from "./github";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(filesRouter);
router.use(deploymentsRouter);
router.use(dnsRouter);
router.use(aiRouter);
router.use(templatesRouter);
router.use(githubRouter);

export default router;
