const admin = require("firebase-admin");

// 인증 미들웨어
async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    }
}

// 로그인 검증
async function verifyLogin(idToken) {
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const db = admin.firestore();

        // 사용자 문서 조회
        const userDoc = await db.collection('user').doc(decodedToken.uid).get();
        const isFirstLogin = !userDoc.exists;

        // 첫 로그인이면 사용자 문서 생성
        if (isFirstLogin) {
            await db.collection('user').doc(decodedToken.uid).set({
                email: decodedToken.email,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                ingredients: [],
                disliked_ingredients: [],
                allergic_ingredients: []
            });
        }

        return {
            success: true,
            uid: decodedToken.uid,
            email: decodedToken.email,
            isFirstLogin: isFirstLogin
        };
    } catch (error) {
        console.error('Login verification error:', error);
        return {
            success: false,
            error: '인증 실패'
        };
    }
}

module.exports = {
    authMiddleware,
    verifyLogin
};