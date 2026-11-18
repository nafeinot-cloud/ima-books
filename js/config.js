/*
 * הגדרות האתר.
 * כל עוד שני הערכים ריקים האתר פועל במצב הדגמה (הנתונים נשמרים רק בדפדפן).
 * המפתח ANON הוא ציבורי בכוונה: ההגנה נעשית בכללי ה-RLS שבקובץ schema.sql.
 * לעולם לא מדביקים כאן service_role.
 */
window.SITE_CONFIG = {
  SUPABASE_URL: 'https://vyxoekxbezdmoeihmgyg.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5eG9la3hiZXpkbW9laWhtZ3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODQ1OTcsImV4cCI6MjExMDI2MDU5N30.bQhzi33Sge0UHaEy1yh69mpO_VHjTpsX2OaSAAvb35Q',
  // כמה זמן (בשניות) בין רענוני זמינות באתר הציבורי
  POLL_SECONDS: 25,
  // מועדי איסוף (חייבים להתאים לרשימה בשרת: claim_items + הפונקציה submit-request)
  PICKUP_SLOTS: [
    { id: '2026-11-21', label: 'מוצאי שבת, 21.11.26' },
    { id: '2026-11-28', label: 'מוצאי שבת, 28.11.26' },
  ],
};
