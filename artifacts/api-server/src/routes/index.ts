import { Router, type IRouter } from "express";
import healthRouter from "./health";
import notifyRouter from "./notify";
import invitesRouter from "./invites";

const router: IRouter = Router();

router.use(healthRouter);
router.use(notifyRouter);
router.use(invitesRouter);

export default router;
