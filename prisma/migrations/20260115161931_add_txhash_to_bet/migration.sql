/*
  Warnings:

  - Added the required column `txHash` to the `Bet` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "txHash" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "pick" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "userId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bet_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Bet" ("amount", "createdAt", "id", "market", "matchId", "pick", "status", "userId") SELECT "amount", "createdAt", "id", "market", "matchId", "pick", "status", "userId" FROM "Bet";
DROP TABLE "Bet";
ALTER TABLE "new_Bet" RENAME TO "Bet";
CREATE UNIQUE INDEX "Bet_txHash_key" ON "Bet"("txHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
