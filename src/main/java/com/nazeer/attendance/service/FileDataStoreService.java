package com.nazeer.attendance.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.nazeer.attendance.model.Account;
import com.nazeer.attendance.model.Employee;
import com.nazeer.attendance.model.PunchRecord;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.*;

@Service
public class FileDataStoreService {
    @Value("${covibe.data-dir:./data-files}")
    private String dataDir;

    @Value("${covibe.attendance-file:data/attendance.dat}")
    private String attendanceFile;

    @Value("${covibe.last-week-file:data/attendance-last-week.dat}")
    private String lastWeekFile;

    @Value("${covibe.users-file:data/users.dat}")
    private String usersFile;

    private final ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    private final List<Account> accounts = new ArrayList<>();
    private final Map<String, Employee> employees = new LinkedHashMap<>();
    private final List<PunchRecord> punches = new ArrayList<>();
    private final Map<String, String> sessions = new ConcurrentHashMap<>();

    @PostConstruct
    public synchronized void init() throws IOException {
        Path dir = Path.of(dataDir);
        Files.createDirectories(dir);

        // 1. Load or initialize fixed 2 Admins & 4 Clients
        Path accFile = dir.resolve("accounts.json");
        if (Files.exists(accFile)) {
            accounts.addAll(mapper.readValue(accFile.toFile(), new TypeReference<>() {}));
        } else {
            accounts.addAll(List.of(
                    new Account("A1", "ADMIN",  "admin1",  "covibe@2026",  "COVIBE-HQ", "CoVibe Admin 1"),
                    new Account("A2", "ADMIN",  "admin2",  "covibe@2027",  "COVIBE-HQ", "CoVibe Admin 2"),
                    new Account("C1", "CLIENT", "client1", "client1@2026", "CL-01",     "Client Company 1"),
                    new Account("C2", "CLIENT", "client2", "client2@2026", "CL-02",     "Client Company 2"),
                    new Account("C3", "CLIENT", "client3", "client3@2026", "CL-03",     "Client Company 3"),
                    new Account("C4", "CLIENT", "client4", "client4@2026", "CL-04",     "Client Company 4")
            ));
            saveAccounts();
        }

        // 2. Load bundled binary user.dat (from classpath:data/user.dat)
        ClassPathResource userRes = new ClassPathResource(usersFile);
        if (userRes.exists()) {
            try (InputStream in = userRes.getInputStream()) {
                loadBinaryUserDat(in.readAllBytes());
            }
        }

        // Merge any saved client assignments from ./data-files/employees.json
        Path empFile = dir.resolve("employees.json");
        if (Files.exists(empFile)) {
            List<Employee> saved = mapper.readValue(empFile.toFile(), new TypeReference<>() {});
            for (Employee e : saved) {
                if (employees.containsKey(e.employeeId)) {
                    if (e.name != null && !e.name.isBlank()) employees.get(e.employeeId).name = e.name;
                    if (e.clientId != null) employees.get(e.employeeId).clientId = e.clientId;
                    if (e.department != null) employees.get(e.employeeId).department = e.department;
                } else {
                    employees.put(e.employeeId, e);
                }
            }
        }

        // 3. Load bundled attendance.dat and attendance-last-week.dat (deduplicated across both files)
        Set<String> seen = new HashSet<>();
        ClassPathResource lastWeekRes = new ClassPathResource(lastWeekFile);
        if (lastWeekRes.exists()) {
            try (InputStream in = lastWeekRes.getInputStream()) {
                loadAttendanceStream(in, "attendance-last-week.dat", seen);
            }
        }
        ClassPathResource attRes = new ClassPathResource(attendanceFile);
        if (attRes.exists()) {
            try (InputStream in = attRes.getInputStream()) {
                loadAttendanceStream(in, "attendance.dat", seen);
            }
        }
    }

    private void loadBinaryUserDat(byte[] bytes) {
        Matcher m = Pattern.compile("[ -~]{2,}").matcher(new String(bytes, StandardCharsets.ISO_8859_1));
        List<Integer> offsets = new ArrayList<>();
        List<String> vals = new ArrayList<>();
        while (m.find()) { offsets.add(m.start()); vals.add(m.group().trim()); }
        for (int i = 0; i < vals.size(); i++) {
            String id = vals.get(i);
            if (!(id.matches("(?i)[A-Z0-9][A-Z0-9_-]{0,39}") && id.matches(".*\\d.*"))) continue;
            String name = null;
            for (int j = i - 1; j >= 0; j--) {
                int dist = offsets.get(i) - offsets.get(j);
                if (dist > 45) break;
                String cand = vals.get(j);
                if (dist > 0 && cand.matches("(?i)[A-Z][A-Z .'_-]{1,60}") && !cand.matches(".*\\d.*")) { name = cand; break; }
            }
            if (name != null) {
                employees.put(id, new Employee(id, name, "", ""));
            }
        }
    }

    private void loadAttendanceStream(InputStream in, String filename, Set<String> seen) throws IOException {
        try (BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                if (line.isBlank()) continue;
                String[] c = line.trim().split("[\\t,;]+");
                if (c.length < 2) continue;
                String eid = c[0].trim().replace("\"", "");
                String tm = c[1].trim().replace("\"", "").replace("T", " ");
                if (eid.isBlank() || !tm.matches("\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}.*")) continue;
                if (tm.length() == 16) tm = tm + ":00";
                String r3 = c.length > 2 ? c[2].trim() : "1";
                String r4 = c.length > 3 ? c[3].trim() : "255";
                String r5 = c.length > 4 ? c[4].trim() : "15";
                if (!"15".equals(r5) && !"1".equals(r5)) continue;
                String r6 = c.length > 5 ? c[5].trim() : "0";
                String key = eid + "|" + tm + "|" + r5;
                if (!seen.add(key)) continue;
                punches.add(new PunchRecord(eid, tm, r3, r4, r5, r6, filename));
                employees.putIfAbsent(eid, new Employee(eid, "Employee " + eid, "", ""));
            }
        }
    }

    public synchronized Map<String, Object> login(String username, String password) {
        Account acc = accounts.stream()
                .filter(a -> a.username.equalsIgnoreCase(username) && Objects.equals(a.password, password))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid username or password."));
        String token = UUID.randomUUID().toString();
        sessions.put(token, acc.id);
        return Map.of("token", token, "user", acc);
    }

    public void logout(String token) {
        if (token != null) sessions.remove(token);
    }

    public Account requireUser(String token) {
        if (token == null || !sessions.containsKey(token))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in required.");
        String id = sessions.get(token);
        return accounts.stream().filter(a -> a.id.equals(id)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Session expired."));
    }

    public Account requireAdmin(String token) {
        Account acc = requireUser(token);
        if (!"ADMIN".equalsIgnoreCase(acc.role))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Admin access required.");
        return acc;
    }

    public synchronized boolean hasAssignedEmployees(String companyCode) {
        return employees.values().stream().anyMatch(e -> companyCode.equalsIgnoreCase(e.clientId));
    }

    public synchronized List<Account> getAccounts() { return new ArrayList<>(accounts); }

    public synchronized String getCompanyName(String companyCode) {
        if (companyCode == null || companyCode.isBlank()) return "CoVibe";
        return accounts.stream()
                .filter(a -> companyCode.equalsIgnoreCase(a.companyCode))
                .map(a -> a.companyName)
                .findFirst()
                .orElse(companyCode);
    }

    public synchronized Account updateAccount(String id, String password, String companyName) throws IOException {
        Account acc = accounts.stream().filter(a -> a.id.equals(id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Account not found: " + id));
        if (password != null && !password.isBlank()) acc.password = password.trim();
        if (companyName != null && !companyName.isBlank()) acc.companyName = companyName.trim();
        saveAccounts();
        return acc;
    }

    public synchronized List<Employee> getEmployees() { return new ArrayList<>(employees.values()); }
    public synchronized Employee getEmployee(String id) { return employees.get(id); }

    public synchronized Employee saveEmployee(Employee emp) throws IOException {
        emp.employeeId = emp.employeeId.trim();
        emp.name = emp.name.trim();
        employees.put(emp.employeeId, emp);
        saveEmployees();
        return emp;
    }

    public synchronized List<PunchRecord> getPunches() { return new ArrayList<>(punches); }

    private void saveAccounts() throws IOException { mapper.writeValue(Path.of(dataDir, "accounts.json").toFile(), accounts); }
    private void saveEmployees() throws IOException { mapper.writeValue(Path.of(dataDir, "employees.json").toFile(), employees.values()); }
}
