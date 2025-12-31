const express = require("express");
const multer = require("multer");
const admin = require("firebase-admin");
const { initializeFirebase, loadIngredientMap, getUserIngredients, findTopRecipes } = require("./firebase");
const { recommendTop3Recipes } = require("./openai");
const { authMiddleware } = require('./auth');
const { verifyLogin } = require('./auth');
const { getQuestionsAndResponses, calculateFMBT } = require("./utils");
const axios = require('axios');
const FormData = require('form-data');
const FASTAPI_URL = process.env.FASTAPI_URL;


const router = express.Router();

// Multer 설정 (메모리 저장소 사용)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024 }
});

let ingredientMap = {};

// 식재료 등록 라우트
router.post("/upload-ingredient", authMiddleware, upload.single("image"), async (req, res) => {
    const userId = req.user.uid;

    try {
        const imageProcessing = async () => {
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({error: "이미지가 필요합니다."});
            }

            const formData = new FormData();
            formData.append('file', req.file.buffer, {
                filename: req.file.originalname,
                contentType: req.file.mimetype
            });

            const response = await axios.post(`${FASTAPI_URL}/detect/`, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Accept': 'application/json'
                }
            });

            if (!response.data.success) {
                throw new Error('식재료 인식 실패');
            }

            // 중복 제거된 한글 식재료명 목록 생성
            const uniqueIngredients = [...new Set(
                response.data.detections
                    .map(detection => ingredientMap[detection.class_name])
                    .filter(name => name)  // undefined나 null 제거
            )];

            if (uniqueIngredients.length === 0) {
                throw new Error('인식된 식재료가 없습니다.');
            }

            return uniqueIngredients;
        };

        const detectedIngredients = await Promise.race([
            imageProcessing(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('이미지 처리 시간이 초과되었습니다.')), 30000)
            )
        ]);

        res.json({
            success: true,
            detectedIngredients: detectedIngredients,
            message: '식재료가 성공적으로 저장되었습니다.'
        });

    } catch (error) {
        console.error("이미지 처리 오류:", error);
        res.status(error.response?.status || 500).json({
            error: error.message || "이미지 처리 중 오류가 발생했습니다."
        });
    }
});

// 레시피 추천 라우트
router.post("/recommend-recipes", authMiddleware,async (req, res) => {
    try {
        // userId를 토큰에서 가져옴
        const userId = req.user.uid;
        const db = admin.firestore();

        // FMBT 정보 조회 추가
        const userDoc = await db.collection('user').doc(userId).get();
        const userFMBT = userDoc.data().fmbt;
        const userIngredients = await getUserIngredients(userId);


        if (!userIngredients || !userIngredients.ingredients || userIngredients.ingredients.length === 0) {
            return res.status(404).json({ error: "등록된 식재료가 없습니다." });
        }
        const topRecipes = await findTopRecipes(userIngredients);
        if (!topRecipes || topRecipes.length === 0) {
            return res.status(404).json({ error: "매칭되는 레시피가 없습니다." });
        }

        const recommendedRecipes = await recommendTop3Recipes(userIngredients, topRecipes, userFMBT, userId);
        if (!recommendedRecipes || recommendedRecipes.length === 0) {
            return res.status(404).json({ error: "추천 레시피를 찾을 수 없습니다." });
        }

        res.json({
            success: true,
            userIngredients,
            recommendedRecipes: recommendedRecipes.map((recipe) => ({
                id: recipe.id,
                ATT_FILE_NO_MAIN: recipe.ATT_FILE_NO_MAIN,
                ATT_FILE_NO_MK: recipe.ATT_FILE_NO_MK,
                HASH_TAG: recipe.HASH_TAG,
                INFO_CAR: recipe.INFO_CAR,
                INFO_ENG: recipe.INFO_ENG,
                INFO_FAT: recipe.INFO_FAT,
                INFO_NA: recipe.INFO_NA,
                INFO_PRO: recipe.INFO_PRO,
                INFO_WGT: recipe.INFO_WGT,
                MANUAL01: recipe.MANUAL01,
                MANUAL02: recipe.MANUAL02,
                MANUAL03: recipe.MANUAL03,
                MANUAL04: recipe.MANUAL04,
                MANUAL05: recipe.MANUAL05,
                MANUAL06: recipe.MANUAL06,
                MANUAL07: recipe.MANUAL07,
                MANUAL08: recipe.MANUAL08,
                MANUAL09: recipe.MANUAL09,
                MANUAL10: recipe.MANUAL10,
                MANUAL11: recipe.MANUAL11,
                MANUAL12: recipe.MANUAL12,
                MANUAL13: recipe.MANUAL13,
                MANUAL14: recipe.MANUAL14,
                MANUAL15: recipe.MANUAL15,
                MANUAL16: recipe.MANUAL16,
                MANUAL17: recipe.MANUAL17,
                MANUAL18: recipe.MANUAL18,
                MANUAL19: recipe.MANUAL19,
                MANUAL20: recipe.MANUAL20,
                MANUAL_IMG01: recipe.MANUAL_IMG01,
                MANUAL_IMG02: recipe.MANUAL_IMG02,
                MANUAL_IMG03: recipe.MANUAL_IMG03,
                MANUAL_IMG04: recipe.MANUAL_IMG04,
                MANUAL_IMG05: recipe.MANUAL_IMG05,
                MANUAL_IMG06: recipe.MANUAL_IMG06,
                MANUAL_IMG07: recipe.MANUAL_IMG07,
                MANUAL_IMG08: recipe.MANUAL_IMG08,
                MANUAL_IMG09: recipe.MANUAL_IMG09,
                MANUAL_IMG10: recipe.MANUAL_IMG10,
                MANUAL_IMG11: recipe.MANUAL_IMG11,
                MANUAL_IMG12: recipe.MANUAL_IMG12,
                MANUAL_IMG13: recipe.MANUAL_IMG13,
                MANUAL_IMG14: recipe.MANUAL_IMG14,
                MANUAL_IMG15: recipe.MANUAL_IMG15,
                MANUAL_IMG16: recipe.MANUAL_IMG16,
                MANUAL_IMG17: recipe.MANUAL_IMG17,
                MANUAL_IMG18: recipe.MANUAL_IMG18,
                MANUAL_IMG19: recipe.MANUAL_IMG19,
                MANUAL_IMG20: recipe.MANUAL_IMG20,
                RCP_NA_TIP: recipe.RCP_NA_TIP,
                RCP_NM: recipe.RCP_NM,
                RCP_PARTS_DTLS: recipe.RCP_PARTS_DTLS,
                RCP_PAT2: recipe.RCP_PAT2,
                RCP_SEQ: recipe.RCP_SEQ,
                RCP_WAY2: recipe.RCP_WAY2,
                fmbtInfo: recipe.fmbtInfo,  // FMBT 정보 추가
                recommendReason: recipe.recommendReason  // 추천 이유 추가
            })),
        });
    } catch (error) {
        console.error("레시피 추천 오류:", error);
        // 상세 에러 메시지 숨기기
        res.status(500).json({ error: "레시피 추천 중 오류가 발생했습니다." });
    }
});

// routes.js 파일에 새로운 라우트 추가
router.post("/save-recipe", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { recipeId } = req.body;

        if (!recipeId) {
            return res.status(400).json({ error: "레시피 ID가 필요합니다." });
        }

        const db = admin.firestore();

        // 레시피 문서 조회
        const recipeDoc = await db.collection("recipes").doc(recipeId).get();

        if (!recipeDoc.exists) {
            return res.status(404).json({ error: "레시피를 찾을 수 없습니다." });
        }

        const recipeData = recipeDoc.data();

        // 사용자 문서에 저장된 레시피 배열 업데이트
        const userRef = db.collection("user").doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: "사용자 정보를 찾을 수 없습니다." });
        }

        // 현재 저장된 레시피 목록 가져오기
        const savedRecipes = userDoc.data().savedRecipes || [];

        // 이미 저장된 레시피인지 확인
        const isAlreadySaved = savedRecipes.some(recipe => recipe.RCP_SEQ === recipeData.RCP_SEQ);

        if (isAlreadySaved) {
            return res.json({
                success: true,
                message: "이미 저장된 레시피입니다."
            });
        }

        // 저장 시간 추가
        const recipeWithTimestamp = {
            ...recipeData,
            savedAt: new Date().toISOString()
        };

        // 새로운 레시피를 포함한 전체 배열 업데이트
        const updatedRecipes = [...savedRecipes, recipeWithTimestamp];

        // 사용자 문서 업데이트
        await userRef.update({
            savedRecipes: updatedRecipes
        });

        res.json({
            success: true,
            message: "레시피가 성공적으로 저장되었습니다."
        });

    } catch (error) {
        console.error("레시피 저장 오류:", error);
        res.status(500).json({ error: "레시피 저장 중 오류가 발생했습니다." });
    }
});

// 저장된 레시피 목록 조회 라우트 추가
router.get("/saved-recipes", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        const db = admin.firestore();

        const userDoc = await db.collection("user").doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: "사용자 정보를 찾을 수 없습니다." });
        }

        const savedRecipes = userDoc.data().savedRecipes || [];

        // 최신 저장 순으로 정렬
        const sortedRecipes = [...savedRecipes].sort((a, b) => {
            const timeA = a.savedAt ? a.savedAt.toDate().getTime() : 0;
            const timeB = b.savedAt ? b.savedAt.toDate().getTime() : 0;
            return timeB - timeA;
        });

        res.json({
            success: true,
            savedRecipes: sortedRecipes
        });

    } catch (error) {
        console.error("저장된 레시피 조회 오류:", error);
        res.status(500).json({ error: "저장된 레시피 조회 중 오류가 발생했습니다." });
    }
});

// 저장된 레시피 삭제 라우트를 인덱스 기반으로 수정
router.delete("/saved-recipe/:index", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        const index = parseInt(req.params.index);

        if (isNaN(index) || index < 0) {
            return res.status(400).json({ error: "유효한 인덱스가 필요합니다." });
        }

        const db = admin.firestore();
        const userRef = db.collection("user").doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: "사용자 정보를 찾을 수 없습니다." });
        }

        const savedRecipes = userDoc.data().savedRecipes || [];

        if (index >= savedRecipes.length) {
            return res.status(404).json({ error: "해당 인덱스에 레시피가 존재하지 않습니다." });
        }

        // 해당 인덱스 제외한 새 배열 생성
        const updatedRecipes = [...savedRecipes.slice(0, index), ...savedRecipes.slice(index + 1)];

        // 사용자 문서 업데이트
        await userRef.update({
            savedRecipes: updatedRecipes
        });

        res.json({
            success: true,
            message: "레시피가 성공적으로 삭제되었습니다."
        });

    } catch (error) {
        console.error("레시피 삭제 오류:", error);
        res.status(500).json({ error: "레시피 삭제 중 오류가 발생했습니다." });
    }
});

router.post("/smart-search", async (req, res) => {
    try {
        const { searchQuery = "" } = req.body;

        // 유효성 검사
        if (!searchQuery || searchQuery.trim() === "") {
            return res.status(400).json({ error: "검색어를 입력해주세요." });
        }

        // 검색어 전처리
        const query = searchQuery.trim();

        const db = admin.firestore();

        // 1. 알려진 식재료인지 확인 (ingredients.csv의 데이터 활용)
        // ingredientMap에서 역방향 매핑 생성 (한글 식재료명 -> 존재 여부)
        const knownIngredients = Object.values(ingredientMap).reduce((acc, name) => {
            if (name) acc[name] = true;
            return acc;
        }, {});

        // 검색어를 공백 기준으로 분리
        const terms = query.split(/\s+/);

        // 알려진 식재료 목록과 일반 검색어 분리
        const foundIngredients = [];
        const generalTerms = [];

        terms.forEach(term => {
            if (knownIngredients[term]) {
                foundIngredients.push(term);
            } else {
                generalTerms.push(term);
            }
        });

        // 일반 검색어 합치기
        const remainingQuery = generalTerms.join(" ");

        console.log("식재료로 인식:", foundIngredients);
        console.log("일반 검색어:", remainingQuery);

        // 레시피 컬렉션 조회
        const recipesRef = db.collection("recipes");
        const snapshot = await recipesRef.get();

        const matchingRecipes = [];
        snapshot.forEach(doc => {
            const recipe = doc.data();
            let match = false;
            let ingredientMatchCount = 0;
            let nameMatchScore = 0;

            // 식재료 일치 여부 확인
            if (foundIngredients.length > 0) {
                const recipeIngredients = recipe.RCP_PARTS_DTLS || "";
                ingredientMatchCount = foundIngredients.filter(ingredient =>
                    recipeIngredients.includes(ingredient)
                ).length;
                if (ingredientMatchCount > 0) match = true;
            }

            // 일반 검색어로 레시피 이름 검색
            if (remainingQuery) {
                const name = recipe.RCP_NM || "";
                if (name.includes(remainingQuery)) {
                    match = true;
                    nameMatchScore = 100; // 이름 일치는 높은 점수 부여
                }
            }

            // 검색어가 빈 문자열일 경우 모든 식재료가 일치했다면 포함
            if ((remainingQuery === "" && foundIngredients.length > 0 && ingredientMatchCount > 0) || match) {
                matchingRecipes.push({
                    id: doc.id,
                    ...recipe,
                    ingredientMatchCount,
                    nameMatchScore,
                    totalMatchScore: ingredientMatchCount + nameMatchScore
                });
            }
        });

        // 총 검색 점수 기준으로 정렬
        matchingRecipes.sort((a, b) => b.totalMatchScore - a.totalMatchScore);

        // 결과 반환
        res.json({
            success: true,
            searchInfo: {
                detectedIngredients: foundIngredients,
                searchTerms: remainingQuery ? [remainingQuery] : []
            },
            recipes: matchingRecipes
        });

    } catch (error) {
        console.error("스마트 검색 오류:", error);
        res.status(500).json({ error: "검색 중 오류가 발생했습니다." });
    }
});

// 로그인 검증 라우트 추가
router.post("/verify-login", async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({ error: '토큰이 필요합니다.' });
    }

    const result = await verifyLogin(idToken);
    if (result.success) {
        res.json(result);
    } else {
        res.status(401).json(result);
    }
});

// ingredientMap 초기화는 서버 시작 후에 수행
let isRoutesInitialized = false;

async function initializeRoutes() {
    if (isRoutesInitialized) {
        return;
    }

    try {
        console.log('라우트 초기화 시작...');
        const { db } = await initializeFirebase();

        if (!db) {
            throw new Error('Firestore 초기화 실패');
        }

        console.log('ingredientMap 로드 시작...');
        ingredientMap = await loadIngredientMap();
        console.log('ingredientMap 로드 완료');

        isRoutesInitialized = true;
    } catch (error) {
        console.error('Error loading ingredientMap:', error);
        throw error;
    }
}

// FMBT 계산 라우트 수정
router.get("/calculate-fmbt", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        const db = admin.firestore();

        // 1. FMBT 계산
        const { questions, responses } = await getQuestionsAndResponses(userId);
        const { fmbt: fmbtResult, scores } = calculateFMBT(questions, responses);

        // 2. FMBT 설명 조회
        const fmbtDoc = await db.collection('fmbt_descriptions').doc(fmbtResult).get();

        if (!fmbtDoc.exists) {
            throw new Error(`FMBT 설명을 찾을 수 없습니다: ${fmbtResult}`);
        }

        const fmbtDescription = fmbtDoc.data().description;

        // 3. 유저 문서에 FMBT 결과 저장
        await db.collection('user').doc(userId).update({
            fmbt: fmbtResult,
            fmbtScores: scores
        });

        // 4. 결과 반환
        return res.json({
            success: true,
            fmbt: fmbtResult,
            scores: scores,
            description: fmbtDescription
        });

    } catch (error) {
        console.error("FMBT 처리 중 오류 발생:", error);
        return res.status(500).json({
            success: false,
            error: "FMBT 처리 중 오류가 발생했습니다"
        });
    }
});

module.exports = {
    router,
    initializeRoutes
};