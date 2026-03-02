"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const identifyService_1 = require("./identifyService");
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT || 3000);
app.use(express_1.default.json());
app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
});
app.post("/identify", async (req, res) => {
    try {
        const { email, phoneNumber } = req.body ?? {};
        const response = await (0, identifyService_1.identifyContact)(email, phoneNumber);
        return res.status(200).json(response);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected server error";
        const statusCode = message === "Either email or phoneNumber must be provided." ? 400 : 500;
        return res.status(statusCode).json({ error: message });
    }
});
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
