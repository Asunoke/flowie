-- CreateTable
CREATE TABLE "circuit_reports" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "findings" JSONB NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circuit_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "circuit_reports_guildId_scannedAt_idx" ON "circuit_reports"("guildId", "scannedAt");
