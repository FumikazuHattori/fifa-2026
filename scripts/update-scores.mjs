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
const FD_TLA_OVERRIDE = {
  HAI: "HTI", // ハイチ
  ALG: "DZA", // アルジェリア
};

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
    // 決勝・3位決定戦はPK戦で決着することがあり、フルタイムの得点だけでは
    // 勝敗が分からない（同点のまま）ことがあるので、APIのwinner判定も保持しておく。
    const winner = m.score?.winner === "HOME_TEAM" ? "home"
      : m.score?.winner === "AWAY_TEAM" ? "away"
      : null;
    return {
      id: m.id,
      home, away,
      score: { [home]: hs ?? 0, [away]: as ?? 0 },
      status: fdStatusToOurs(m.status),
      stage: m.stage || "GROUP_STAGE",
      winner,
      date: m.utcDate || null,
    };
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

// 得点ランキング（/scorers）はAPIの契約プランによっては取得できないコンペティションもあるため、
// 失敗してもscores.json本体の更新は止めない（非致命的に扱う）。
try {
  const scorersRes = await fetch("https://api.football-data.org/v4/competitions/WC/scorers?limit=50", {
    headers: { "X-Auth-Token": TOKEN },
  });
  if (!scorersRes.ok) {
    console.warn(`得点ランキングの取得に失敗しました（HTTP ${scorersRes.status}）。scorers.jsonの更新をスキップします。`);
  } else {
    const scorersData = await scorersRes.json();
    const scorers = (scorersData.scorers || []).map(s => ({
      player: s.player?.name || "",
      team: fdToOurCode(s.team) || s.team?.tla || "",
      goals: s.goals ?? 0,
      assists: s.assists ?? 0,
      penalties: s.penalties ?? 0,
    }));
    await writeFile(
      "scorers.json",
      JSON.stringify({ updatedAt: new Date().toISOString(), scorers }, null, 2) + "\n"
    );
    console.log(`scorers.json を更新しました（${scorers.length}人）`);
  }
} catch (e) {
  console.warn(`得点ランキングの取得中にエラーが発生しました: ${e.message}`);
}

// チーム情報（エンブレム・所属メンバー）も同様に非致命的に扱う。
// /teams は1チームずつ詳細を返すエンドポイントもあるが、コンペティション単位で
// 一括取得できる /competitions/WC/teams を使い、リクエスト数を抑える。
try {
  const teamsRes = await fetch("https://api.football-data.org/v4/competitions/WC/teams", {
    headers: { "X-Auth-Token": TOKEN },
  });
  if (!teamsRes.ok) {
    console.warn(`チーム情報の取得に失敗しました（HTTP ${teamsRes.status}）。teams.jsonの更新をスキップします。`);
  } else {
    const teamsData = await teamsRes.json();
    const teams = {};
    for (const t of teamsData.teams || []) {
      const code = fdToOurCode(t);
      if (!code) continue;
      teams[code] = {
        crest: t.crest || null,
        squad: (t.squad || []).map(p => ({
          name: p.name || "",
          position: p.position || "",
          nationality: p.nationality || "",
        })),
      };
    }
    await writeFile(
      "teams.json",
      JSON.stringify({ updatedAt: new Date().toISOString(), teams }, null, 2) + "\n"
    );
    console.log(`teams.json を更新しました（${Object.keys(teams).length}チーム）`);
  }
} catch (e) {
  console.warn(`チーム情報の取得中にエラーが発生しました: ${e.message}`);
}
