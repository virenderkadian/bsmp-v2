-- Seed the default business profile row used as the letterhead on printed bills.
-- Editable afterwards from Settings; this only provides a working starting value.
INSERT INTO "BusinessProfile" (
    "id", "businessName", "contactPhone", "addressLine1", "addressLine2",
    "bankAccountName", "bankAccountNumber", "bankIfsc", "bankName", "upiId",
    "footerNote", "updatedAt"
) VALUES (
    'default',
    'BHRAMHSHAKTI MILK PRODUCT',
    '9588514344',
    'SUNARIAN BYEPASS ROHTAK',
    NULL,
    'BHRAMHSHAKTI MILK PRODUCT',
    '209588514344',
    'ESFB0011004',
    'EQUITAS BANK',
    'bhramshakti@equitasbank',
    'प्रिय ग्राहक, आपसे निवेदन है कि अपने बिल की पूर्ण पेमेंट हर माह 5 तारीख से पहले करें। कृपया अधूरी पेमेंट न करें, ऐसी पेमेंट मान्य नहीं होगी। पेमेंट करने के बाद स्क्रीनशॉट ऑफिस नंबर 7988135701 पर अवश्य भेजें। धन्यवाद।',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
