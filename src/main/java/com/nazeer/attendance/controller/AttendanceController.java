package com.nazeer.attendance.controller;

import com.nazeer.attendance.model.Account;
import com.nazeer.attendance.model.Employee;
import com.nazeer.attendance.model.PunchRecord;
import com.nazeer.attendance.service.FileDataStoreService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api")
public class AttendanceController {
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private final FileDataStoreService store;

    public AttendanceController(FileDataStoreService store) { this.store = store; }

    private boolean isClient(Account acc) { return !"ADMIN".equalsIgnoreCase(acc.role); }

    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> importAttendance(@RequestHeader(value = "X-Auth-Token", required = false) String token,
                                                @RequestParam("file") MultipartFile file) throws Exception {
        store.requireAdmin(token);
        return store.importAttendanceFile(file);
    }

    @PostMapping(value = "/users/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> importUsers(@RequestHeader(value = "X-Auth-Token", required = false) String token,
                                           @RequestParam("file") MultipartFile file) throws IOException {
        store.requireAdmin(token);
        return store.importBinaryUserDat(file);
    }

    @DeleteMapping("/records/clear")
    public Map<String, Object> clear(@RequestHeader(value = "X-Auth-Token", required = false) String token) throws IOException {
        store.requireAdmin(token);
        return Map.of("cleared", store.clearPunches());
    }

    @GetMapping("/users")
    public List<Employee> employees(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        Account acc = store.requireUser(token);
        boolean client = isClient(acc);
        return store.getEmployees().stream()
                .filter(e -> !client || acc.companyCode.equalsIgnoreCase(e.clientId))
                .map(e -> new Employee(e.employeeId, client ? Employee.maskName(e.name) : e.name, e.clientId, e.department))
                .toList();
    }

    @PostMapping("/users")
    public Employee saveEmployee(@RequestHeader(value = "X-Auth-Token", required = false) String token,
                                 @RequestBody Employee emp) throws IOException {
        store.requireAdmin(token);
        return store.saveEmployee(emp);
    }

    @DeleteMapping("/users/{id}")
    public Map<String, String> deleteEmployee(@RequestHeader(value = "X-Auth-Token", required = false) String token,
                                              @PathVariable String id) throws IOException {
        store.requireAdmin(token);
        store.deleteEmployee(id);
        return Map.of("deleted", id);
    }

    /**
     * Two-shift daily summary:
     *  - Day Shift   (7 AM - 7 PM): First Face (15) between 07:00 and 18:59
     *  - Night Shift (7 PM - 7 AM): First Face (15) between 19:00 and 06:59 (pairs next-morning Fingerprint 1 before 10:00 AM)
     */
    @GetMapping("/daily-summary")
    public List<Map<String, Object>> dailySummary(@RequestHeader(value = "X-Auth-Token", required = false) String token,
                                                  @RequestParam(required = false) String shift) {
        Account acc = store.requireUser(token);
        boolean client = isClient(acc);

        Map<String, List<PunchRecord>> byEmp = new TreeMap<>();
        for (PunchRecord p : store.getPunches()) {
            Employee e = store.getEmployee(p.employeeId);
            if (client && (e == null || !acc.companyCode.equalsIgnoreCase(e.clientId))) continue;
            if (p.punchTime == null || p.punchTime.length() < 16) continue;
            byEmp.computeIfAbsent(p.employeeId, k -> new ArrayList<>()).add(p);
        }

        List<Map<String, Object>> out = new ArrayList<>();
        byEmp.forEach((empId, plist) -> {
            plist.sort(Comparator.comparing(p -> p.punchTime));
            Map<String, List<PunchRecord>> insMap = new LinkedHashMap<>();
            Map<String, List<PunchRecord>> outsMap = new LinkedHashMap<>();
            String lastNightKey = null;
            LocalDateTime lastNightIn = null;

            for (PunchRecord p : plist) {
                LocalDateTime dt;
                try { dt = LocalDateTime.parse(p.punchTime.length() == 16 ? p.punchTime + ":00" : p.punchTime, FMT); }
                catch (Exception ex) { continue; }
                int h = dt.getHour();
                LocalDate calDate = dt.toLocalDate();

                if ("15".equals(p.rawField5)) {
                    String sDate, sType;
                    if (h >= 7 && h < 19) {
                        sDate = calDate.toString(); sType = "Day";
                        lastNightKey = null; lastNightIn = null;
                    } else if (h >= 19) {
                        sDate = calDate.toString(); sType = "Night";
                        lastNightKey = sDate + "|" + sType; lastNightIn = dt;
                    } else {
                        sDate = calDate.minusDays(1).toString(); sType = "Night";
                        lastNightKey = sDate + "|" + sType; lastNightIn = dt;
                    }
                    insMap.computeIfAbsent(sDate + "|" + sType, k -> new ArrayList<>()).add(p);
                    outsMap.putIfAbsent(sDate + "|" + sType, new ArrayList<>());
                } else if ("1".equals(p.rawField5)) {
                    boolean inNightWindow = lastNightKey != null && lastNightIn != null && dt.isAfter(lastNightIn)
                            && Duration.between(lastNightIn, dt).toHours() <= 15 && h < 10;
                    String targetKey;
                    if (inNightWindow) {
                        targetKey = lastNightKey;
                    } else if (h < 7) {
                        targetKey = calDate.minusDays(1) + "|Night";
                    } else {
                        String sameDayNight = calDate + "|Night";
                        if (insMap.containsKey(sameDayNight) && !insMap.get(sameDayNight).isEmpty()
                                && p.punchTime.compareTo(insMap.get(sameDayNight).get(0).punchTime) >= 0) {
                            targetKey = sameDayNight;
                        } else {
                            targetKey = calDate + "|Day";
                        }
                    }
                    insMap.putIfAbsent(targetKey, new ArrayList<>());
                    outsMap.computeIfAbsent(targetKey, k -> new ArrayList<>()).add(p);
                }
            }

            Employee emp = store.getEmployee(empId);
            String rawName = emp != null ? emp.name : "Employee " + empId;
            for (String key : insMap.keySet()) {
                String[] parts = key.split("\\|", 2);
                String sDate = parts[0], sType = parts[1];
                if (shift != null && !shift.isBlank() && !shift.equalsIgnoreCase(sType)) continue;
                List<PunchRecord> ins = insMap.get(key);
                List<PunchRecord> outs = outsMap.getOrDefault(key, List.of());
                String firstLogin = ins.isEmpty() ? null : ins.get(0).punchTime;
                String lastLogout = outs.isEmpty() ? null : outs.get(outs.size() - 1).punchTime;
                long mins = 0;
                if (firstLogin != null && lastLogout != null) {
                    try {
                        LocalDateTime t1 = LocalDateTime.parse(firstLogin, FMT), t2 = LocalDateTime.parse(lastLogout, FMT);
                        if (t2.isAfter(t1)) mins = Duration.between(t1, t2).toMinutes();
                    } catch (Exception ignored) {}
                }
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("employeeId", empId);
                row.put("employeeName", client ? Employee.maskName(rawName) : rawName);
                row.put("date", sDate);
                row.put("shift", sType);
                row.put("firstLogin", firstLogin != null ? firstLogin : "");
                row.put("lastLogout", lastLogout != null ? lastLogout : "");
                row.put("faceInCount", ins.size());
                row.put("fingerOutCount", outs.size());
                row.put("totalSpan", (mins / 60) + "h " + (mins % 60) + "m");
                out.add(row);
            }
        });
        out.sort(Comparator.comparing((Map<String, Object> r) -> String.valueOf(r.get("date"))).reversed()
                .thenComparing(r -> String.valueOf(r.get("shift")))
                .thenComparing(r -> String.valueOf(r.get("employeeId"))));
        return out;
    }
}
