-- Optional default groups. Run via:
--   sqlite3 raha.sqlite < lib/seed.sql
-- after first boot. UUIDs are static so the file is idempotent (PRIMARY KEY conflicts are ignored).

INSERT OR IGNORE INTO CATEGORY_GROUP (ID, NAME, EMOJI, COLOR, SORT_ORDER) VALUES
('00000000-0000-0000-0000-000000000001', 'Home',     '🏠', 'blue',   1),
('00000000-0000-0000-0000-000000000002', 'Car',      '🚗', 'orange', 2),
('00000000-0000-0000-0000-000000000003', 'Kids',     '👶', 'green',  3),
('00000000-0000-0000-0000-000000000004', 'Services', '📱', 'red',    4),
('00000000-0000-0000-0000-000000000005', 'Personal', '👨', 'purple', 5);
