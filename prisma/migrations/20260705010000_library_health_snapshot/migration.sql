CREATE TABLE "LibraryHealthSnapshot" (
  "id" TEXT NOT NULL,
  "libraryId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LibraryHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryHealthSnapshot_libraryId_key" ON "LibraryHealthSnapshot"("libraryId");
CREATE INDEX "LibraryHealthSnapshot_updatedAt_idx" ON "LibraryHealthSnapshot"("updatedAt");

ALTER TABLE "LibraryHealthSnapshot"
  ADD CONSTRAINT "LibraryHealthSnapshot_libraryId_fkey"
  FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
