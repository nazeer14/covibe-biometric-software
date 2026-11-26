# CoVibe Attendance Portal (Zero-Database, File-Based)

Lightweight Spring Boot 3.5 attendance portal with **zero database setup** — reads and saves manual uploaded files (`.dat`, `user.dat`, `.csv`, `.xlsx`, `.json`) directly to `./data-files/`.

## Fixed Accounts (2 Admins & 4 Clients)
- **Admins** (full upload, employee mapping, account passwords, clear data):
  - `admin1` / `covibe@2026`
  - `admin2` / `covibe@2027`
- **Clients** (read-only, own company only, masked names `Na####r`, no upload or clear options):
  - `client1` / `client1@2026` (`CL-01`)
  - `client2` / `client2@2026` (`CL-02`)
  - `client3` / `client3@2026` (`CL-03`)
  - `client4` / `client4@2026` (`CL-04`)

## Biometric Rules
- Column 5 (`rawField5`) = `15` → **Face Check-In** (First `15` of the day = Login)
- Column 5 (`rawField5`) = `1` → **Fingerprint Check-Out** (Last `1` of the day = Logout)

## Run
```bash
mvn clean spring-boot:run
```
Open http://localhost:8080.
