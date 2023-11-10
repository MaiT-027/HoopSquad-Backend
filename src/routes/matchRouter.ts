import express from "express";
import { PrismaClient } from "@prisma/client";
import { AllMatch, AddMatch, MatchFilter, MatchInfo } from "../match/match";

const matchRouter = express.Router();

matchRouter.get("/", async (req, res) => {
  // 전체 게시글 조회
  try {
    const result = await AllMatch(req);
    res.status(200);
    res.send(result);
  } catch (err) {
    console.log(err);
    res.send({ result: "error" });
  }
});

matchRouter.get("/filter", async (req, res) => {
  try {
    const add = await MatchFilter(req);
    res.status(200);
    res.send(add);
  } catch (err) {
    console.log(err);
    res.send({ result: "error" });
  }
});

matchRouter.get("/info", async (req, res) => {
  try {
    const add = await MatchInfo(req);
    res.status(200);
    res.send(add);
  } catch (err) {
    console.log(err);
    res.send({ result: "error" });
  }
});

matchRouter.get("/add", async (req, res) => {
  try {
    const add = await AddMatch(req);
    res.status(201);
    res.send(add);
  } catch (err) {
    console.log(err);
    res.send({ result: "error" });
  }
});

module.exports = matchRouter;
