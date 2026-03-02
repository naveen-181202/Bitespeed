import express from "express";
import { identifyContact } from "./identifyService";
import { IdentifyRequestBody } from "./types";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post(
  "/identify",
  async (
    req: express.Request<unknown, unknown, IdentifyRequestBody>,
    res: express.Response
  ) => {
    try {
      const { email, phoneNumber } = req.body ?? {};
      const response = await identifyContact(email, phoneNumber);
      return res.status(200).json(response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected server error";
      const statusCode =
        message === "Either email or phoneNumber must be provided." ? 400 : 500;

      return res.status(statusCode).json({ error: message });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
