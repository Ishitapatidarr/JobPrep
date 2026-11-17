const express = require("express");
require("./config/env"); // loads Backend/.env (once)
const cookieParser = require("cookie-parser");
const interviewRouter = require("./routes/interview.routes");

/*require all the routes here*/
const authRouter = require("./routes/auth.routes");
const cors = require("cors")

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: "http://localhost:5173",
    credentials: true
}))




/* using all the routes here*/ 
app.use("/api/auth", authRouter);
app.use("/api/interview", interviewRouter);


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
