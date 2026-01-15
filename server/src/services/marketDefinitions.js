function resolveKillLeader(snapshot) {
  if (!snapshot) return null;
  const radiant = Number(snapshot.r);
  const dire = Number(snapshot.d);
  if (!Number.isFinite(radiant) || !Number.isFinite(dire)) return null;
  if (radiant > dire) return "Radiant";
  if (dire > radiant) return "Dire";
  return "Draw";
}

const MarketDefinitions = {
  MATCH_WINNER: {
    label: "Match Winner",
    timer: 1800,
    snapshotSeconds: 1800,
    odds: {
      Radiant: { num: 18, den: 10, display: 1.8 },
      Dire: { num: 18, den: 10, display: 1.8 },
      Draw: { num: 0, den: 1, display: 0 }
    },
    resolve: ({ snapshot }) => resolveKillLeader(snapshot)
  },
  KILLS_10MIN: {
    label: "Kills @10:00 (Leader / Draw)",
    timer: 600,
    snapshotSeconds: 600,
    odds: {
      Radiant: { num: 2, den: 1, display: 2.0 },
      Dire: { num: 2, den: 1, display: 2.0 },
      Draw: { num: 4, den: 1, display: 4.0 }
    },
    resolve: ({ snapshot }) => resolveKillLeader(snapshot)
  },
  KILLS_15MIN: {
    label: "Kills @15:00 (Leader / Draw)",
    timer: 900,
    snapshotSeconds: 900,
    odds: {
      Radiant: { num: 5, den: 2, display: 2.5 },
      Dire: { num: 5, den: 2, display: 2.5 },
      Draw: { num: 6, den: 1, display: 6.0 }
    },
    resolve: ({ snapshot }) => resolveKillLeader(snapshot)
  }
};

module.exports = MarketDefinitions;
