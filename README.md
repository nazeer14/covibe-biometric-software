# CoVibe Attendance Portal

Zero-database Spring Boot 3.5 attendance portal with multi-file period reports (`All Data`, `Last Week Report`, `Last Month Report`, and `Custom Period`).

## Bundled Data Files (`src/main/resources/data/`)
- **`attendance.dat`** — Current attendance export
- **`attendance-last-week.dat`** — Last week attendance export (powering the **Last Week Report** filter)
- **`users.dat`** — Binary employee directory

Replace these files weekly and redeploy; duplicates across files are automatically skipped.

## Default Logins (2 Admins & 4 Clients)
- **Admins**: `admin1` / `covibe@2026`, `admin2` / `covibe@2027`
- **Clients**: `client1`–`client4` (`client1@2026` … `client4@2026`)
