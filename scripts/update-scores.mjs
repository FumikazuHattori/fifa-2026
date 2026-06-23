// GitHub Actionsから定期実行し、football-data.orgのワールドカップ試合結果を
// scores.json として書き出すスクリプト。サーバー側（Actionsランナー）から叩くので、
// ブラウザのCORS制限を受けない。
import { writeFile } from "node:fs/promises";

const TOKEN = process.env.FD_API_TOKEN;
if (!TOKEN) {
  console.error("FD_API_TOKEN が設定されていません（リポジトリのSecretsに登録してください）");
  process.exit(1);
}

// football-data.org のtla（3文字コード）が、アプリ内のコードと食い違う場合だけ上書きする。
const FD_TLA_OVERRIDE = {};

const fdToOurCode = team => {
  const tla = team?.tla;
  if (!tla) return null;
  return FD_TLA_OVERRIDE[tla] || tla;
};

const fdStatusToOurs = s => {
  if (s === "FINISHED") return "final";
  if (s === "IN_PLAY" || s === "PAUSED") return "live";
  return "scheduled";
};

const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
  headers: { "X-Auth-Token": TOKEN },
});
if (!res.ok) {
  console.error(`football-data.org への取得に失敗しました: HTTP ${res.status}`);
  process.exit(1);
}

const data = await res.json();
const games = (data.matches || [])
  .map(m => {
    const home = fdToOurCode(m.homeTeam);
    const away = fdToOurCode(m.awayTeam);
    if (!home || !away) return null;
    const hs = m.score?.fullTime?.home;
    const as = m.score?.fullTime?.away;
    return { home, away, score: { [home]: hs ?? 0, [away]: as ?? 0 }, status: fdStatusToOurs(m.status) };
  })
  .filter(Boolean);

if (games.length === 0) {
  console.error("取得した試合データが0件でした。書き込みを中止します。");
  process.exit(1);
}

await writeFile(
  "scores.json",
  JSON.stringify({ updatedAt: new Date().toISOString(), games }, null, 2) + "\n"
);
console.log(`scores.json を更新しました（${games.length}試合）`);
