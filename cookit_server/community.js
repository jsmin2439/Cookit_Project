const express = require('express');
const { authMiddleware } = require('./auth');
const multer = require('multer');
const admin = require('firebase-admin');

const router = express.Router();

// 이미지 업로드를 위한 multer 설정
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB 제한
});

// 커뮤니티 게시물 작성 라우트 (인덱스 기반으로 수정)
router.post('/community/post', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        const { recipeIndex, content, title, tags } = req.body;
        const userId = req.user.uid;
        const image = req.file;

        // 필수 필드 검증
        if (recipeIndex === undefined || !content || !title) {
            return res.status(400).json({
                success: false,
                error: '레시피 인덱스, 내용, 제목이 모두 필요합니다.'
            });
        }

        // 태그 검증 및 처리 (문자열로 전달된 경우 배열로 변환)
        let tagArray = tags;
        if (typeof tags === 'string') {
            tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag);
        }

        // 태그 최대 5개로 제한
        tagArray = tagArray.slice(0, 5);

        const db = admin.firestore();

        // 사용자 정보 가져오기
        const userDoc = await db.collection('user').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '사용자 정보를 찾을 수 없습니다.'
            });
        }

        // 저장된 레시피 확인 (인덱스로 접근)
        const userData = userDoc.data();
        const savedRecipes = userData.savedRecipes || [];
        const recipeIdx = parseInt(recipeIndex);

        if (isNaN(recipeIdx) || recipeIdx < 0 || recipeIdx >= savedRecipes.length) {
            return res.status(400).json({
                success: false,
                error: '유효하지 않은 레시피 인덱스입니다.'
            });
        }

        const recipeToShare = savedRecipes[recipeIdx];

        // 이미지 업로드 (이미지가 있는 경우)
        let imageUrl = null;
        if (image) {
            const bucket = admin.storage().bucket();
            const imageFileName = `community/${userId}/${Date.now()}.jpg`;
            const file = bucket.file(imageFileName);

            // 파일 업로드
            await file.save(image.buffer, {
                metadata: {
                    contentType: image.mimetype
                }
            });

            // 파일 URL 생성
            await file.makePublic();
            imageUrl = `https://storage.googleapis.com/${bucket.name}/${imageFileName}`;
        }

        // 사용자 이름 가져오기
        const userName = userData.name || userData.email || '익명';

        // 커뮤니티 게시물 데이터 생성
        const postData = {
            userId,
            userName,
            title,
            content,
            imageUrl,
            recipe: recipeToShare,
            likedBy: [],
            comments: [],
            tags: tagArray,
            ratings: {},      // 평점 정보 초기화
            avgRating: 0,     // 평균 평점 초기화
            ratingCount: 0,   // 평점 개수 초기화
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Firestore에 게시물 저장
        const postRef = await db.collection('community').add(postData);

        // 각 태그에 대해 태그 카운트 증가 처리
        for (const tag of tagArray) {
            const tagRef = db.collection('tags').doc(tag);
            const tagDoc = await tagRef.get();

            if (tagDoc.exists) {
                await tagRef.update({
                    count: admin.firestore.FieldValue.increment(1),
                    posts: admin.firestore.FieldValue.arrayUnion(postRef.id)
                });
            } else {
                await tagRef.set({
                    tag: tag,
                    count: 1,
                    posts: [postRef.id],
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        // 사용자 문서에 작성한 게시물 ID 추가
        const userPosts = userData.posts || [];
        userPosts.push(postRef.id);
        await db.collection('user').doc(userId).update({
            posts: userPosts
        });

        res.status(201).json({
            success: true,
            message: '게시물이 성공적으로 작성되었습니다.',
            postId: postRef.id
        });

    } catch (error) {
        console.error('커뮤니티 게시물 작성 오류:', error);
        res.status(500).json({
            success: false,
            error: '게시물 작성 중 오류가 발생했습니다.'
        });
    }
});

// 커뮤니티 게시물 목록 조회 라우트
router.get('/community/posts', async (req, res) => {
    try {
        const { page = 1, limit = 10, tag, search, sort = 'recent' } = req.query;
        const pageNumber = parseInt(page);
        const limitNumber = parseInt(limit);

        if (isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
            return res.status(400).json({ error: '유효하지 않은 페이지 파라미터입니다.' });
        }

        const db = admin.firestore();

        // 기본 쿼리 설정 - 최신순으로 정렬
        let postsQuery = db.collection('community').orderBy('createdAt', 'desc');

        // 태그가 지정된 경우 필터링
        if (tag) {
            postsQuery = postsQuery.where('tags', 'array-contains', tag);
        }

        // 모든 게시물 가져오기 (검색어가 있는 경우 서버에서 필터링)
        const postsSnapshot = await postsQuery.get();

        // 검색 필터링 및 관련도 점수 계산
        let filteredPosts = [];
        postsSnapshot.forEach(doc => {
            const postData = doc.data();
            const postItem = {
                id: doc.id,
                title: postData.title,
                content: postData.content,
                imageUrl: postData.recipe?.ATT_FILE_NO_MAIN || postData.imageUrl,
                createdAt: postData.createdAt,
                likeCount: (postData.likedBy || []).length,
                commentCount: (postData.comments || []).length,
                tags: postData.tags || [],
                avgRating: postData.avgRating || 0,
                ratingCount: postData.ratingCount || 0,
                userName: postData.userName || '익명'
            };

            // 검색어가 있는 경우 필터링 적용
            if (search) {
                const searchLower = search.toLowerCase();
                const titleMatch = postData.title?.toLowerCase().includes(searchLower);
                const contentMatch = postData.content?.toLowerCase().includes(searchLower);
                const tagsMatch = (postData.tags || []).some(tag =>
                    tag.toLowerCase().includes(searchLower));

                // 관련도 점수 계산
                let relevanceScore = 0;
                if (titleMatch) relevanceScore += 3;  // 제목 일치: 3점
                if (tagsMatch) relevanceScore += 2;   // 태그 일치: 2점
                if (contentMatch) relevanceScore += 1; // 내용 일치: 1점

                if (titleMatch || contentMatch || tagsMatch) {
                    filteredPosts.push({
                        ...postItem,
                        relevanceScore
                    });
                }
            } else {
                // 검색어가 없으면 모든 게시물 포함
                filteredPosts.push({
                    ...postItem,
                    relevanceScore: 0
                });
            }
        });

        // 정렬 적용
        if (search && sort === 'relevance') {
            // 관련도순 정렬 (검색어가 있을 때만)
            filteredPosts.sort((a, b) => b.relevanceScore - a.relevanceScore);
        }
        // 최신순은 이미 Firestore 쿼리에서 정렬된 상태

        // 전체 게시물 수
        const totalCount = filteredPosts.length;

        // 페이지네이션 적용
        const start = (pageNumber - 1) * limitNumber;
        const end = start + limitNumber;
        const paginatedPosts = filteredPosts.slice(start, end);

        res.json({
            success: true,
            posts: paginatedPosts,
            pagination: {
                page: pageNumber,
                limit: limitNumber,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitNumber)
            }
        });

    } catch (error) {
        console.error('커뮤니티 게시물 조회 오류:', error);
        res.status(500).json({
            error: '게시물 조회 중 오류가 발생했습니다.'
        });
    }
});
// 게시물 상세 조회 라우트
router.get('/community/post/:postId', async (req, res) => {
    try {
        const { postId } = req.params;

        if (!postId) {
            return res.status(400).json({
                success: false,
                error: '게시물 ID가 필요합니다.'
            });
        }

        const db = admin.firestore();
        const postDoc = await db.collection('community').doc(postId).get();

        if (!postDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '게시물을 찾을 수 없습니다.'
            });
        }

        const postData = postDoc.data();

        // 요청에 사용자 정보가 있는 경우 (로그인한 사용자)
        let userRating = null;
        if (req.user && req.user.uid) {
            userRating = postData.ratings ? postData.ratings[req.user.uid] || null : null;
        }

        // 좋아요 카운트 추가
        const likeCount = postData.likedBy ? postData.likedBy.length : 0;

        res.json({
            success: true,
            post: {
                id: postDoc.id,
                userId: postData.userId,
                userName: postData.userName,
                title: postData.title,
                content: postData.content,
                imageUrl: postData.imageUrl,
                recipe: postData.recipe,
                likedBy: postData.likedBy || [],
                comments: postData.comments || [],
                tags: postData.tags || [],
                avgRating: postData.avgRating || 0,       // 평균 평점 추가
                ratingCount: postData.ratingCount || 0,   // 평점 개수 추가
                userRating: userRating,
                likeCount: likeCount, // 좋아요 카운트 추가
                createdAt: postData.createdAt?.toDate() || null
            }
        });

    } catch (error) {
        console.error('게시물 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: '게시물 조회 중 오류가 발생했습니다.'
        });
    }
});

// 인기 태그 목록 조회 API
router.get('/community/popular-tags', async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        const limitNumber = parseInt(limit);

        if (isNaN(limitNumber) || limitNumber < 1) {
            return res.status(400).json({
                success: false,
                error: '유효한 제한 수가 필요합니다.'
            });
        }

        const db = admin.firestore();

        // 태그 컬렉션에서 카운트 기준으로 정렬하여 가져오기
        const tagsSnapshot = await db.collection('tags')
            .orderBy('count', 'desc')
            .limit(limitNumber)
            .get();

        const tags = [];
        tagsSnapshot.forEach(doc => {
            const tagData = doc.data();
            tags.push({
                tag: doc.id,
                count: tagData.count || 0,
                postCount: tagData.posts?.length || 0
            });
        });

        res.json({
            success: true,
            tags
        });

    } catch (error) {
        console.error('인기 태그 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: '인기 태그 조회 중 오류가 발생했습니다.'
        });
    }
});

// 게시물 태그 수정 API 추가
router.put('/community/post/:postId/tags', authMiddleware, async (req, res) => {
    try {
        const { postId } = req.params;
        const { tags = [] } = req.body;
        const userId = req.user.uid;

        // 태그 검증 및 처리
        let tagArray = tags;
        if (typeof tags === 'string') {
            tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag);
        }

        // 태그 최대 5개로 제한
        tagArray = tagArray.slice(0, 5);

        const db = admin.firestore();
        const postRef = db.collection('community').doc(postId);
        const postDoc = await postRef.get();

        if (!postDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '게시물을 찾을 수 없습니다.'
            });
        }

        const postData = postDoc.data();

        // 작성자만 수정 가능
        if (postData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: '자신이 작성한 게시물만 수정할 수 있습니다.'
            });
        }

        // 기존 태그 목록
        const oldTags = postData.tags || [];

        // 기존 태그 카운트 감소
        for (const oldTag of oldTags) {
            const tagRef = db.collection('tags').doc(oldTag);
            const tagDoc = await tagRef.get();

            if (tagDoc.exists) {
                const tagData = tagDoc.data();
                const updatedPosts = tagData.posts.filter(id => id !== postId);

                if (updatedPosts.length === 0) {
                    // 해당 태그를 사용하는 게시물이 없으면 태그 문서 삭제
                    await tagRef.delete();
                } else {
                    await tagRef.update({
                        count: admin.firestore.FieldValue.increment(-1),
                        posts: updatedPosts
                    });
                }
            }
        }

        // 새 태그 카운트 증가
        for (const newTag of tagArray) {
            const tagRef = db.collection('tags').doc(newTag);
            const tagDoc = await tagRef.get();

            if (tagDoc.exists) {
                await tagRef.update({
                    count: admin.firestore.FieldValue.increment(1),
                    posts: admin.firestore.FieldValue.arrayUnion(postId)
                });
            } else {
                await tagRef.set({
                    tag: newTag,
                    count: 1,
                    posts: [postId],
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        // 게시물 태그 업데이트
        await postRef.update({
            tags: tagArray
        });

        res.json({
            success: true,
            message: '태그가 성공적으로 업데이트되었습니다.',
            tags: tagArray
        });

    } catch (error) {
        console.error('태그 수정 오류:', error);
        res.status(500).json({
            success: false,
            error: '태그 수정 중 오류가 발생했습니다.'
        });
    }
});

// 게시물 좋아요 라우트
router.post('/community/post/:postId/like', authMiddleware, async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.user.uid;

        if (!postId) {
            return res.status(400).json({
                success: false,
                error: '게시물 ID가 필요합니다.'
            });
        }

        const db = admin.firestore();
        const postRef = db.collection('community').doc(postId);
        const postDoc = await postRef.get();

        if (!postDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '게시물을 찾을 수 없습니다.'
            });
        }

        const postData = postDoc.data();
        const likedBy = postData.likedBy || [];

        // 이미 좋아요를 눌렀는지 확인
        const alreadyLiked = likedBy.includes(userId);

        if (alreadyLiked) {
            // 좋아요 취소
            await postRef.update({
                likedBy: admin.firestore.FieldValue.arrayRemove(userId)
            });

            return res.json({
                success: true,
                message: '좋아요가 취소되었습니다.',
                liked: false
            });
        } else {
            // 좋아요 추가
            await postRef.update({
                likedBy: admin.firestore.FieldValue.arrayUnion(userId)
            });

            return res.json({
                success: true,
                message: '좋아요가 추가되었습니다.',
                liked: true
            });
        }

    } catch (error) {
        console.error('좋아요 처리 오류:', error);
        res.status(500).json({
            success: false,
            error: '좋아요 처리 중 오류가 발생했습니다.'
        });
    }
});

// 게시물 댓글 작성 라우트 수정
router.post('/community/post/:postId/comment', authMiddleware, async (req, res) => {
    try {
        const { postId } = req.params;
        const { content } = req.body;
        const userId = req.user.uid;

        if (!postId || !content) {
            return res.status(400).json({ error: '게시물 ID와 댓글 내용이 필요합니다.' });
        }

        const db = admin.firestore();
        const postRef = db.collection('community').doc(postId);
        const postDoc = await postRef.get();

        if (!postDoc.exists) {
            return res.status(404).json({ error: '게시물을 찾을 수 없습니다.' });
        }

        // 사용자 정보 가져오기
        const userDoc = await db.collection('user').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: '사용자 정보를 찾을 수 없습니다.' });
        }

        const userData = userDoc.data();
        const userName = userData.name || userData.email || '사용자';

        // 현재 시간을 Timestamp 객체로 생성 (serverTimestamp 대신)
        const timestamp = admin.firestore.Timestamp.now();

        // 댓글 데이터 생성
        const commentData = {
            userId,
            userName,
            content,
            createdAt: timestamp, // serverTimestamp() 대신 Timestamp.now() 사용
            commentId: `${postId}_${userId}_${Date.now()}`
        };

        // 게시물에 댓글 추가
        await postRef.update({
            comments: admin.firestore.FieldValue.arrayUnion(commentData)
        });

        res.status(201).json({
            success: true,
            message: '댓글이 등록되었습니다.',
            comment: commentData
        });

    } catch (error) {
        console.error('댓글 작성 오류:', error);
        res.status(500).json({
            error: '댓글 등록 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// 게시물 삭제 라우트
router.delete('/community/post/:postId', authMiddleware, async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.user.uid;

        if (!postId) {
            return res.status(400).json({
                success: false,
                error: '게시물 ID가 필요합니다.'
            });
        }

        const db = admin.firestore();
        const postRef = db.collection('community').doc(postId);
        const postDoc = await postRef.get();

        // 게시물 존재 확인
        if (!postDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '게시물을 찾을 수 없습니다.'
            });
        }

        const postData = postDoc.data();

        // 게시물 작성자 확인
        if (postData.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: '자신이 작성한 게시물만 삭제할 수 있습니다.'
            });
        }

        // 이미지가 있는 경우 Storage에서 삭제
        if (postData.imageUrl) {
            try {
                const bucket = admin.storage().bucket();
                const imageFileName = postData.imageUrl.split('/').pop();
                const file = bucket.file(`community/${userId}/${imageFileName}`);
                await file.delete();
            } catch (imageError) {
                console.error('이미지 삭제 오류:', imageError);
                // 이미지 삭제 실패해도 게시물 삭제는 계속 진행
            }
        }

        // 사용자 문서에서 게시물 ID 제거
        const userRef = db.collection('user').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            const userData = userDoc.data();
            const userPosts = userData.posts || [];
            const updatedPosts = userPosts.filter(id => id !== postId);

            await userRef.update({
                posts: updatedPosts
            });
        }

        // 게시물 삭제
        await postRef.delete();

        res.json({
            success: true,
            message: '게시물이 성공적으로 삭제되었습니다.'
        });

    } catch (error) {
        console.error('게시물 삭제 오류:', error);
        res.status(500).json({
            success: false,
            error: '게시물 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 게시물 레이팅 라우트
router.post('/community/post/:postId/rating', authMiddleware, async (req, res) => {
    try {
        const { postId } = req.params;
        const { rating } = req.body;
        const userId = req.user.uid;

        // 유효성 검사
        if (!postId) {
            return res.status(400).json({
                success: false,
                error: '게시물 ID가 필요합니다.'
            });
        }

        // 평점 유효성 검사
        const ratingValue = parseFloat(rating);
        if (isNaN(ratingValue) || ratingValue < 1 || ratingValue > 5) {
            return res.status(400).json({
                success: false,
                error: '평점은 1에서 5 사이의 숫자여야 합니다.'
            });
        }

        const db = admin.firestore();
        const postRef = db.collection('community').doc(postId);
        const postDoc = await postRef.get();

        if (!postDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '게시물을 찾을 수 없습니다.'
            });
        }

        const postData = postDoc.data();
        const ratings = postData.ratings || {};

        // 새 평점 정보 갱신
        ratings[userId] = ratingValue;

        // 평균 평점 계산
        const ratingValues = Object.values(ratings);
        const avgRating = ratingValues.reduce((sum, val) => sum + val, 0) / ratingValues.length;

        // Firestore 업데이트
        await postRef.update({
            ratings: ratings,
            avgRating: avgRating,
            ratingCount: ratingValues.length
        });

        return res.json({
            success: true,
            message: '평점이 성공적으로 저장되었습니다.',
            avgRating: avgRating,
            ratingCount: ratingValues.length
        });

    } catch (error) {
        console.error('평점 처리 오류:', error);
        res.status(500).json({
            success: false,
            error: '평점 처리 중 오류가 발생했습니다.'
        });
    }
});

// 댓글 수정 라우트
router.put('/community/post/:postId/comment/:commentId', authMiddleware, async (req, res) => {
    try {
        const { postId, commentId } = req.params;
        const { content } = req.body;
        const userId = req.user.uid;

        if (!postId || !commentId || !content) {
            return res.status(400).json({
                success: false,
                error: '게시물 ID, 댓글 ID, 댓글 내용이 모두 필요합니다.'
            });
        }

        const db = admin.firestore();
        const postRef = db.collection('community').doc(postId);
        const postDoc = await postRef.get();

        if (!postDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '게시물을 찾을 수 없습니다.'
            });
        }

        const postData = postDoc.data();
        const comments = postData.comments || [];

        // 댓글 찾기
        const commentIndex = comments.findIndex(comment => comment.commentId === commentId);

        if (commentIndex === -1) {
            return res.status(404).json({
                success: false,
                error: '댓글을 찾을 수 없습니다.'
            });
        }

        // 댓글 작성자 확인
        if (comments[commentIndex].userId !== userId) {
            return res.status(403).json({
                success: false,
                error: '자신이 작성한 댓글만 수정할 수 있습니다.'
            });
        }

        // 댓글 내용 업데이트
        comments[commentIndex].content = content;
        comments[commentIndex].updatedAt = admin.firestore.Timestamp.now();

        await postRef.update({ comments });

        res.json({
            success: true,
            message: '댓글이 성공적으로 수정되었습니다.',
            comment: comments[commentIndex]
        });

    } catch (error) {
        console.error('댓글 수정 오류:', error);
        res.status(500).json({
            success: false,
            error: '댓글 수정 중 오류가 발생했습니다.'
        });
    }
});

// 댓글 삭제 라우트
router.delete('/community/post/:postId/comment/:commentId', authMiddleware, async (req, res) => {
    try {
        const { postId, commentId } = req.params;
        const userId = req.user.uid;

        if (!postId || !commentId) {
            return res.status(400).json({
                success: false,
                error: '게시물 ID와 댓글 ID가 필요합니다.'
            });
        }

        const db = admin.firestore();
        const postRef = db.collection('community').doc(postId);
        const postDoc = await postRef.get();

        if (!postDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '게시물을 찾을 수 없습니다.'
            });
        }

        const postData = postDoc.data();
        const comments = postData.comments || [];

        // 댓글 찾기
        const commentIndex = comments.findIndex(comment => comment.commentId === commentId);

        if (commentIndex === -1) {
            return res.status(404).json({
                success: false,
                error: '댓글을 찾을 수 없습니다.'
            });
        }

        // 댓글 작성자 확인
        if (comments[commentIndex].userId !== userId) {
            return res.status(403).json({
                success: false,
                error: '자신이 작성한 댓글만 삭제할 수 있습니다.'
            });
        }

        // 댓글 삭제
        comments.splice(commentIndex, 1);

        await postRef.update({ comments });

        res.json({
            success: true,
            message: '댓글이 성공적으로 삭제되었습니다.'
        });

    } catch (error) {
        console.error('댓글 삭제 오류:', error);
        res.status(500).json({
            success: false,
            error: '댓글 삭제 중 오류가 발생했습니다.'
        });
    }
});

// community.js 파일에 사용자별 게시물 조회 라우트 추가
router.get('/community/user-posts', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        const db = admin.firestore();

        const postsQuery = db.collection('community')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc');

        const postsSnapshot = await postsQuery.get();

        const posts = [];
        postsSnapshot.forEach(doc => {
            const postData = doc.data();
            posts.push({
                id: doc.id,
                title: postData.title,
                content: postData.content,
                imageUrl: postData.recipe?.ATT_FILE_NO_MAIN || postData.imageUrl,
                createdAt: postData.createdAt,
                likeCount: (postData.likedBy || []).length,
                commentCount: (postData.comments || []).length,
                tags: postData.tags || [],
                avgRating: postData.avgRating || 0,
                ratingCount: postData.ratingCount || 0
            });
        });

        res.json({
            success: true,
            posts
        });

    } catch (error) {
        console.error('사용자 게시물 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: '게시물 목록 조회 중 오류가 발생했습니다.'
        });
    }
});


// 게시물 수정 라우트 추가
router.put('/community/post/:postId', authMiddleware, async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.user.uid;
        const { title, content, tags } = req.body;

        const db = admin.firestore();
        const postRef = db.collection('community').doc(postId);
        const postDoc = await postRef.get();

        if (!postDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '게시물을 찾을 수 없습니다.'
            });
        }

        // 본인 게시물인지 확인
        if (postDoc.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: '본인의 게시물만 수정할 수 있습니다.'
            });
        }

        // 업데이트할 필드
        const updateData = {};
        if (title) updateData.title = title;
        if (content) updateData.content = content;
        if (tags) updateData.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());

        await postRef.update(updateData);

        res.json({
            success: true,
            message: '게시물이 성공적으로 수정되었습니다.'
        });

    } catch (error) {
        console.error('게시물 수정 오류:', error);
        res.status(500).json({
            success: false,
            error: '게시물 수정 중 오류가 발생했습니다.'
        });
    }
});

// 사용자가 좋아요한 게시물 목록 조회 라우트
router.get('/community/liked-posts', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { page = 1, limit = 10 } = req.query;
        const pageNumber = parseInt(page);
        const limitNumber = parseInt(limit);

        if (isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
            return res.status(400).json({
                success: false,
                error: '유효하지 않은 페이지 파라미터입니다.'
            });
        }

        const db = admin.firestore();
        // likedBy 배열에 사용자 ID가 포함된 게시물 쿼리
        const postsQuery = db.collection('community')
            .where('likedBy', 'array-contains', userId)
            .orderBy('createdAt', 'desc');

        const postsSnapshot = await postsQuery.get();

        // 좋아요한 게시물이 없는 경우 처리
        if (postsSnapshot.empty) {
            return res.json({
                success: true,
                message: '좋아요한 게시물이 없습니다.',
                posts: [],
                pagination: {
                    page: pageNumber,
                    limit: limitNumber,
                    total: 0,
                    totalPages: 0
                }
            });
        }

        const likedPosts = [];
        postsSnapshot.forEach(doc => {
            const postData = doc.data();
            likedPosts.push({
                id: doc.id,
                title: postData.title,
                content: postData.content,
                imageUrl: postData.recipe?.ATT_FILE_NO_MAIN || postData.imageUrl,
                createdAt: postData.createdAt,
                likeCount: (postData.likedBy || []).length,
                commentCount: (postData.comments || []).length,
                tags: postData.tags || [],
                avgRating: postData.avgRating || 0,
                ratingCount: postData.ratingCount || 0,
                userName: postData.userName || '익명'
            });
        });

        // 페이지네이션 적용
        const totalCount = likedPosts.length;
        const start = (pageNumber - 1) * limitNumber;
        const end = start + limitNumber;
        const paginatedPosts = likedPosts.slice(start, end);

        res.json({
            success: true,
            posts: paginatedPosts,
            pagination: {
                page: pageNumber,
                limit: limitNumber,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitNumber)
            }
        });

    } catch (error) {
        console.error('좋아요한 게시물 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: '게시물 목록 조회 중 오류가 발생했습니다.'
        });
    }
});

module.exports = router;