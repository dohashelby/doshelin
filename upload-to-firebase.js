// reviews.json → Firestore 마이그레이션 (최초 1회만 실행)
// 사용법: node upload-to-firebase.js

const fs = require('fs');
const https = require('https');

const PROJECT_ID = 'doshelin-a4d1f';
const API_KEY = 'AIzaSyBGvSAcAQ0OJo4_wqgVV8V_AI9TDzq4yuU';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFirestore(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      if (v === '') continue;
      fields[k] = { stringValue: v };
    } else if (typeof v === 'number') {
      fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    } else if (Array.isArray(v) && v.length > 0) {
      fields[k] = { arrayValue: { values: v.map(i => ({ stringValue: String(i) })) } };
    }
  }
  return { fields };
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.error) reject(new Error(json.error.message));
        else resolve(json);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const reviews = JSON.parse(fs.readFileSync('./reviews.json', 'utf-8'));
  console.log(`\n${reviews.length}편 업로드 시작...\n`);

  for (const review of reviews) {
    if (!review.michelin) review.michelin = 0;

    process.stdout.write(`  [${review.id}] "${review.title}" ... `);
    try {
      await post(`${BASE}/reviews?key=${API_KEY}`, toFirestore(review));
      console.log('완료');
    } catch(e) {
      console.log(`실패: ${e.message}`);
    }
    await sleep(300);
  }

  console.log('\n업로드 완료!');
}

main().catch(console.error);
