const express = require("express");
const path = require("path");
const fs = require("fs");
require("./config/env"); // loads Backend/.env (once)
const cookieParser = require("cookie-parser");
const interviewRouter = require("./routes/interview.routes");

/*require all the routes here*/
const authRouter = require("./routes/auth.routes");
const cors = require("cors")

const app = express();
app.set("trust proxy", 1); // behind Render's HTTPS proxy
app.use(express.json());
app.use(cookieParser());

// Local dev: Vite on :5173 calls the API cross-origin. In production the frontend is
// served by this same app, so no CORS is needed. Extra origins: CORS_ORIGIN (comma-separated).
const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://jobprep-frontend.onrender.com",
    ...(process.env.CORS_ORIGIN || "")
        .split(",")
        .map(origin => origin.trim().replace(/\/$/, ""))
        .filter(Boolean)
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.get("/healthz", (req, res) => res.json({ status: "ok" }));


/* using all the routes here*/
app.use("/api/auth", authRouter);
app.use("/api/interview", interviewRouter);


/* Serve the built React app (Frontend/dist) when it exists — single-service deployment */
const FRONTEND_DIST = path.resolve(__dirname, "../../Frontend/dist");
if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    // SPA fallback: any non-API GET returns index.html so client-side routes work on refresh
    app.get(/^\/(?!api\/).*/, (req, res) => {
        res.sendFile(path.join(FRONTEND_DIST, "index.html"));
    });
}


/* JSON error handler (upload errors + any unhandled errors) */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err && err.name === "MulterError") {
        const message = err.code === "LIMIT_FILE_SIZE"
            ? "Resume file is too large. Maximum size is 3MB."
            : err.message || "Invalid resume upload."
        return res.status(400).json({ message })
    }

    console.error("Unhandled error:", err)
    res.status(err.status || 500).json({
        message: "Something went wrong on the server. Please try again."
    })
});


module.exports = app;
