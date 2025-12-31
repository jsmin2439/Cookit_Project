const levenshtein = require("fast-levenshtein");
const admin = require("firebase-admin");

// 스펠링 유사도 계산 함수
function getStringSimilarity(str1, str2) {
    const distance = levenshtein.get(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - distance / maxLength;
}

// Jaccard 유사도 함수 (새로 추가)
function jaccardSimilarity(str1, str2) {
    const tokenize = s => new Set(s.toLowerCase().split(/\s+/));
    const set1 = tokenize(str1);
    const set2 = tokenize(str2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}

// 혼합 유사도 함수 (새로 추가)
function hybridSimilarity(str1, str2, alpha = 0.5) {
    const levSim = getStringSimilarity(str1, str2);
    const jacSim = jaccardSimilarity(str1, str2);
    return alpha * jacSim + (1 - alpha) * levSim;
}

// 사용자의 재료와 레시피 재료 매칭도 계산 함수 (수정됨)
function calculateMatchScore(userIngredients, recipeIngredients) {
    let totalScore = 0;

    recipeIngredients.forEach((recipeIngredient) => {
        let bestSim = 0;
        userIngredients.forEach((userIngredient) => {
            const sim = hybridSimilarity(recipeIngredient, userIngredient);
            if (sim > bestSim) {
                bestSim = sim;
            }
        });
        totalScore += bestSim;
    });

    return totalScore / recipeIngredients.length;
}

async function getQuestionsAndResponses(userId) {
    const db = admin.firestore();
    const questionsRef = db.collection("questions");
    const usersRef = db.collection("user").doc(userId);

    const questionsSnapshot = await questionsRef.get();
    const questions = {};
    questionsSnapshot.forEach(doc => {
        questions[doc.id] = doc.data().questions.length;
    });

    const userDoc = await usersRef.get();
    if (!userDoc.exists) {
        throw new Error("사용자 응답 데이터를 찾을 수 없습니다.");
    }
    const userData = userDoc.data();
    const responses = {
        "1": userData["responses-1"] || [],
        "2": userData["responses-2"] || [],
        "3": userData["responses-3"] || [],
        "4": userData["responses-4"] || []
    };

    return { questions, responses };
}

function calculateFMBT(questions, responses) {

    const scores = {
        E_C: 0,  // responses-1
        F_S: 0,  // responses-2
        S_G: 0,  // responses-3
        B_M: 0   // responses-4
    };

    // responses-1 합계 계산 (E_C)
    if (responses["1"]) {
        scores.E_C = responses["1"].reduce((sum, score) => sum + score, 0);
    }

    // responses-2 합계 계산 (F_S)
    if (responses["2"]) {
        scores.F_S = responses["2"].reduce((sum, score) => sum + score, 0);
    }

    // responses-3 합계 계산 (S_G)
    if (responses["3"]) {
        scores.S_G = responses["3"].reduce((sum, score) => sum + score, 0);
    }

    // responses-4 합계 계산 (B_M)
    if (responses["4"]) {
        scores.B_M = responses["4"].reduce((sum, score) => sum + score, 0);
    }

    const fmbt = [
        scores.E_C >= 15 ? "E" : "C",
        scores.F_S >= 15 ? "F" : "S",
        scores.S_G >= 15 ? "S" : "G",
        scores.B_M >= 15 ? "B" : "M"
    ].join("");

    return { fmbt, scores };
}

async function saveFMBTResult(userId, fmbtResult) {
    const db = admin.firestore();
    await db.collection("user").doc(userId).set(
        {
            fmbt: fmbtResult
        },
        { merge: true }
    );
}

module.exports = {
    calculateMatchScore,
    getQuestionsAndResponses,
    calculateFMBT
};
