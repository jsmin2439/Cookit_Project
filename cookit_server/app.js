const express = require("express");
const { router, initializeRoutes } = require("./routes");
const { initializeFirebase, getDb } = require("./firebase");
const { initializeOpenAI } = require("./openai");
const { authMiddleware } = require('./auth');
const communityRouter = require('./community');

require("dotenv").config();

// Express 앱 생성 및 미들웨어 설정
const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const FASTAPI_URL = process.env.FASTAPI_URL;
console.log('FastAPI URL:', FASTAPI_URL);

// CORS 설정 수정:
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", process.env.CLIENT_ORIGIN);
    res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// 라우터 설정
app.use("/verify-login", router);
app.use("/api", (req, res, next) => {
    // db 객체를 request에 추가
    req.db = getDb();
    next();
});
app.use("/api", authMiddleware);
app.use("/api", router);
app.use('/api', communityRouter);

// 헬스 체크 라우트
app.get("/", (req, res) => {
    res.status(200).send("Server is running");
});

// 에러 처리 미들웨어 (반드시 next 포함)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: "서버 오류가 발생했습니다.",
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});


// 서버 초기화 및 시작
async function startServer() {
    try {
        await initializeFirebase();
        await initializeOpenAI();
        await initializeRoutes();

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server is running on port ${PORT}`);
        }).on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${PORT} is already in use`);
                process.exit(1);
            }
            throw error;
        });
    } catch (error) {
        console.error('Initialization error:', error);
        process.exit(1);
    }
}

startServer();