import { Router, type IRouter } from "express";
import healthRouter from "./health";
import notifyRouter from "./notify";
import invitesRouter from "./invites";
import videoRouter from "./video";
import reolinkRouter from "./reolink";

const router: IRouter = Router();

router.use(healthRouter);
router.use(notifyRouter);
router.use(invitesRouter);
router.use(videoRouter);
router.use(reolinkRouter);

export default router;
