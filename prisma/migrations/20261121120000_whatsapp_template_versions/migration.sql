-- Edited wording for WhatsApp templates, so the office can reword a message from the
-- app. See the model comment in schema.prisma. Purely additive: a new table, nothing
-- existing is touched, and with the table empty the app sends exactly what it did before.
CREATE TABLE "WhatsAppTemplateVersion" (
    "id" UUID NOT NULL,
    "templateKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "zoepactName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "footer" TEXT NOT NULL,
    "buttonText" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppTemplateVersion_zoepactName_key" ON "WhatsAppTemplateVersion"("zoepactName");
CREATE UNIQUE INDEX "WhatsAppTemplateVersion_templateKey_version_key" ON "WhatsAppTemplateVersion"("templateKey", "version");
CREATE INDEX "WhatsAppTemplateVersion_templateKey_idx" ON "WhatsAppTemplateVersion"("templateKey");

-- One active version per template. Prisma can't express a partial index, so it lives
-- here; the app also switches versions inside one transaction, this is the backstop.
CREATE UNIQUE INDEX "WhatsAppTemplateVersion_one_active_per_key" ON "WhatsAppTemplateVersion"("templateKey") WHERE "isActive";
