// TMDB API로 reviews.json 메타데이터 자동 채우기
// 사용법: node tmdb-fetch.js <YOUR_TMDB_API_KEY>
// 또는:   $env:TMDB_API_KEY="키"; node tmdb-fetch.js

const fs = require('fs');
const https = require('https');

const API_KEY = process.env.TMDB_API_KEY || process.argv[2];
if (!API_KEY) {
  console.error('오류: TMDB API 키가 필요합니다.');
  console.error('사용법: node tmdb-fetch.js <YOUR_TMDB_API_KEY>');
  process.exit(1);
}

const TMDB_BASE = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://www.themoviedb.org/t/p/w1280';
const BACKDROP_BASE = 'https://www.themoviedb.org/t/p/w1280';

function get(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      https.get(url, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('JSON 파싱 실패')); }
        });
      }).on('error', err => {
        if (remaining > 0) {
          setTimeout(() => attempt(remaining - 1), 1500);
        } else {
          reject(err);
        }
      });
    };
    attempt(retries);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// "2019~2026" 같은 범위 연도에서 시작 연도만 추출
function extractYear(year) {
  return String(year).split(/[~\-–]/)[0].trim();
}

async function searchTMDB(title, year, mediaType) {
  const endpoint = mediaType === 'movie' ? 'search/movie' : 'search/tv';
  const yearKey = mediaType === 'movie' ? 'year' : 'first_air_date_year';
  const y = extractYear(year);
  const url = `${TMDB_BASE}/${endpoint}?api_key=${API_KEY}&query=${encodeURIComponent(title)}&${yearKey}=${y}&language=ko-KR`;
  const res = await get(url);
  return res.results?.[0] || null;
}

async function searchTMDBNoYear(title, mediaType) {
  const endpoint = mediaType === 'movie' ? 'search/movie' : 'search/tv';
  const url = `${TMDB_BASE}/${endpoint}?api_key=${API_KEY}&query=${encodeURIComponent(title)}&language=ko-KR`;
  const res = await get(url);
  return res.results?.[0] || null;
}

async function getDetails(id, mediaType) {
  const url = `${TMDB_BASE}/${mediaType}/${id}?api_key=${API_KEY}&append_to_response=credits,videos&language=ko-KR`;
  return await get(url);
}

// 장르 → TMDB 미디어 타입 매핑
function getMediaType(genre) {
  if (genre === '영화') return ['movie'];
  if (genre === '드라마') return ['tv', 'movie'];
  if (genre === '애니메이션') return ['tv', 'movie'];
  return null; // 웹툰 등
}

async function findTMDB(review) {
  const types = getMediaType(review.genre);
  if (!types) return null;

  for (const mediaType of types) {
    // 연도 포함 검색
    let result = await searchTMDB(review.title, review.year, mediaType);
    if (result) return { result, mediaType };
    await sleep(200);

    // 연도 없이 재시도
    result = await searchTMDBNoYear(review.title, mediaType);
    if (result) return { result, mediaType };
    await sleep(200);
  }
  return null;
}

async function processReview(review) {
  if (review.genre === '웹툰') {
    console.log(`  [SKIP] "${review.title}" — 웹툰`);
    return review;
  }

  if (review.mediaType) {
    console.log(`  [SKIP] "${review.title}" — 이미 처리됨`);
    return review;
  }

  process.stdout.write(`  [FETCH] "${review.title}" (${review.year}) ... `);

  const found = await findTMDB(review);
  if (!found) {
    console.log('검색 결과 없음');
    return review;
  }

  const { result, mediaType } = found;
  await sleep(300);
  const details = await getDetails(result.id, mediaType);

  // 포스터
  if (details.poster_path) {
    review.poster = `${POSTER_BASE}${details.poster_path}`;
  }

  // 배경 이미지 (신규)
  if (details.backdrop_path) {
    review.backdrop = `${BACKDROP_BASE}${details.backdrop_path}`;
  }

  // 원제 (비어있을 때만)
  if (!review.originalTitle) {
    review.originalTitle = details.original_title || details.original_name || '';
  }

  // 미디어 타입 저장 (재실행 시 스킵용)
  review.mediaType = mediaType;

  // 런타임 (분)
  if (mediaType === 'movie' && details.runtime) {
    review.runtime = details.runtime;
  } else if (details.episode_run_time?.[0]) {
    review.runtime = details.episode_run_time[0];
  }

  // TMDB 대중 평점
  if (details.vote_average != null) {
    review.tmdbRating = Math.round(details.vote_average * 10) / 10;
  }

  // 출연진 top 5
  const cast = details.credits?.cast?.slice(0, 5).map(c => c.name) || [];
  if (cast.length) review.cast = cast;

  // TMDB 공식 줄거리
  if (details.overview) review.tmdbOverview = details.overview;

  console.log(`완료 (tmdbId: ${result.id}, ${mediaType})`);
  return review;
}

async function main() {
  const path = './reviews.json';
  let reviews;
  try {
    reviews = JSON.parse(fs.readFileSync(path, 'utf-8'));
  } catch (e) {
    console.error('reviews.json 읽기 실패:', e.message);
    process.exit(1);
  }

  // 백업 (최초 1회)
  fs.writeFileSync(path + '.bak', fs.readFileSync(path));

  const skippable = reviews.filter(r => r.genre === '웹툰' || r.tmdbId).length;
  const toFetch = reviews.length - skippable;
  console.log(`\n총 ${reviews.length}편 | 조회 대상: ${toFetch}편 | 스킵: ${skippable}편\n`);

  for (const review of reviews) {
    await processReview(review);
    // 매 항목 처리 후 즉시 저장 (중간에 죽어도 유실 없음)
    fs.writeFileSync(path, JSON.stringify(reviews, null, 2), 'utf-8');
    await sleep(350);
  }

  console.log('\n완료! reviews.json 업데이트됨. (원본 백업 → reviews.json.bak)');
}

main().catch(err => {
  console.error('\n오류 발생:', err.message);
  process.exit(1);
});
