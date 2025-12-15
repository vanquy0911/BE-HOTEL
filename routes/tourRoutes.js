// BE-HOTEL/Routes/tourRoutes.js
import express from "express";
import { getToursAndLocation } from "../Controller/tourController.js";

const router = express.Router();

router.get("/", getToursAndLocation);

export default router;


