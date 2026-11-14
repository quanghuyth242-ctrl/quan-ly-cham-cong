
import express from "express";
import path from "path";
import session from "express-session";
import { fileURLToPath } from "url";
import AuthRouter from "./routers/AuthRouter.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../frontend/views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "../frontend/public")));

app.use(session({
    secret: "quanlychamcong_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24
    }
}));

app.use("/", AuthRouter);

app.get("/", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    res.render("home");
});

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
});
