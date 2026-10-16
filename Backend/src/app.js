const express = require("express");
require("dotenv").config();
const cookieParser = require("cookie-parser");

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

/* require all the routes here */
const authRouter = require("./routes/auth.routes")
const interviewRouter = require("./routes/interview.routes")


/* using all the routes here*/ 
app.use("/api/auth", authRouter);
app.use("/api/interview", interviewRouter);


module.exports = app;
