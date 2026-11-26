package com.nazeer.attendance.controller;

import com.nazeer.attendance.model.Account;
import com.nazeer.attendance.model.Employee;
import com.nazeer.attendance.model.PunchRecord;
import com.nazeer.attendance.service.FileDataStoreService;
import org.springframework.web.bind.annotation.*;

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

    private boolean visibleToUser(Employee e, Account acc) {
        if (!isClient(acc)) return true;
        // If this client has explicitly assigned employees, show only theirs; otherwise show all bundled records (masked)
        if (!store.hasAssignedEmployees(acc.companyCode)) return true;
        return e != null && acc.companyCode.equalsIgnoreCase(e.clientId);
    }

    @GetMapping("/users")
    public List<Map<String, Object>> employees(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        Account acc = store.requireUser(token);
        boolean client = isClient(acc);
        return store.getEmployees().stream()
                .filter(e -> visibleToUser(e, acc))
                .map(e -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("employeeId", e.employeeId);
                    m.put("name", client ? Employee.maskName(e.name) : e.name);
                    m.put("maskedName", Employee.maskName(e.name));
                    m.put("clientId", e.clientId == null ? "" : e.clientId);
                    m.put("clientName", store.getCompanyName(e.clientId));
                    m.put("department", e.department == null ? "" : e.department);
                    return m;
                }).toList();
    }

    @PostMapping("/users")
    public Employee saveEmployee(@RequestHeader(value = "X-Auth-Token", required = false) String token,
                                 @RequestBody Employee emp) throws IOException {
        store.requireAdmin(token);
        return store.saveEmployee(emp);
    }

    @GetMapping("/records")
    public List<Map<String, Object>> records(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        Account acc = store.requireUser(token);
        boolean client = isClient(acc);
        List<Map<String, Object>> out = new ArrayList<>();
        for (PunchRecord p : store.getPunches()) {
            Employee e = store.getEmployee(p.employeeId);
            if (!visibleToUser(e, acc)) continue;
            String rawName = e != null ? e.name : "Employee " + p.employeeId;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("employeeId", p.employeeId);
            m.put("employeeName", client ? Employee.maskName(rawName) : rawName);
            m.put("clientId", e != null && e.clientId != null ? e.clientId : "");
            m.put("clientName", e != null ? store.getCompanyName(e.clientId) : "CoVibe");
            m.put("punchTime", p.punchTime);
            m.put("rawField3", p.rawField3);
            m.put("rawField4", p.rawField4);
            m.put("rawField5", p.rawField5);
            m.put("rawField6", p.rawField6);
            m.put("sourceFile", p.sourceFile);
            out.add(m);
        }
        return out;
    }

    @GetMapping("/daily-summary")
    public List<Map<String, Object>> dailySummary(@RequestHeader(value = "X-Auth-Token", required = false) String token,
                                                  @RequestParam(required = false) String shift) {
        Account acc = store.requireUser(token);
        boolean client = isClient(acc);

        Map<String, List<PunchRecord>> byEmp = new TreeMap<>();
        for (PunchRecord p : store.getPunches()) {
            Employee e = store.getEmployee(p.employeeId);
            if (!visibleToUser(e, acc)) continue;
            if (p.punchTime == null || p.punchTime.length() < 16) continue;
            byEmp.computeIfAbsent(p.employeeId, k -> new ArrayList<>()).add(p);
        }

        List<Map<String, Object>> out = new ArrayList<>();
        byEmp.forEach((empId, plist) -> {
            plist.sort(Comparator.comparing(p -> p.punchTime));
            Map<String, List<PunchRecord>> insMap = new LinkedHashMap<>();
            Map<String, List<PunchRecord>> outsMap = new LinkedHashMap<>();
            Map<String, List<PunchRecord>> allMap = new LinkedHashMap<>();
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
                    String k = sDate + "|" + sType;
                    insMap.computeIfAbsent(k, x -> new ArrayList<>()).add(p);
                    outsMap.putIfAbsent(k, new ArrayList<>());
                    allMap.computeIfAbsent(k, x -> new ArrayList<>()).add(p);
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
                    outsMap.computeIfAbsent(targetKey, x -> new ArrayList<>()).add(p);
                    allMap.computeIfAbsent(targetKey, x -> new ArrayList<>()).add(p);
                }
            }

            Employee emp = store.getEmployee(empId);
            String rawName = emp != null ? emp.name : "Employee " + empId;
            String clId = emp != null && emp.clientId != null ? emp.clientId : "";
            String clName = store.getCompanyName(clId);

            for (String key : insMap.keySet()) {
                String[] parts = key.split("\\|", 2);
                String sDate = parts[0], sType = parts[1];
                if (shift != null && !shift.isBlank() && !shift.equalsIgnoreCase(sType)) continue;
                List<PunchRecord> ins = insMap.get(key);
                List<PunchRecord> outs = outsMap.getOrDefault(key, List.of());
                String firstLogin = ins.isEmpty() ? null : ins.get(0).punchTime;
                String lastLogout = outs.isEmpty() ? null : outs.get(outs.size() - 1).punchTime;
                long mins = 0;
                boolean nextDayLogout = lastLogout != null && lastLogout.substring(0, 10).compareTo(sDate) > 0;
                if (firstLogin != null && lastLogout != null) {
                    try {
                        LocalDateTime t1 = LocalDateTime.parse(firstLogin, FMT), t2 = LocalDateTime.parse(lastLogout, FMT);
                        if (t2.isAfter(t1)) mins = Duration.between(t1, t2).toMinutes();
                    } catch (Exception ignored) {}
                }
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("key", empId + "|" + key);
                row.put("employeeId", empId);
                row.put("employeeName", client ? Employee.maskName(rawName) : rawName);
                row.put("clientId", clId);
                row.put("clientName", clName);
                row.put("date", sDate);
                row.put("shift", sType);
                row.put("firstLogin", firstLogin);
                row.put("lastLogout", lastLogout);
                row.put("nextDayLogout", nextDayLogout);
                row.put("inCount", ins.size());
                row.put("outCount", outs.size());
                row.put("minutes", mins);
                List<PunchRecord> sessPunches = allMap.getOrDefault(key, List.of());
                boolean fromLastWeekFile = sessPunches.stream().anyMatch(x -> "attendance-last-week.dat".equals(x.sourceFile));
                row.put("fromLastWeekFile", fromLastWeekFile);
                row.put("punches", sessPunches);
                out.add(row);
            }
        });
        out.sort(Comparator.comparing((Map<String, Object> r) -> String.valueOf(r.get("date"))).reversed()
                .thenComparing(r -> String.valueOf(r.get("shift")))
                .thenComparing(r -> String.valueOf(r.get("employeeId"))));
        return out;
    }
}
