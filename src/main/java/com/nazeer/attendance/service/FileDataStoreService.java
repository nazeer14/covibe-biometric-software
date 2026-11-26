package com.nazeer.attendance.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.nazeer.attendance.model.Account;
import com.nazeer.attendance.model.Employee;
import com.nazeer.attendance.model.PunchRecord;
import jakarta.annotation.PostConstruct;
import org.apache.poi.ss.usermodel.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
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

    private final ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    private final List<Account> accounts = new ArrayList<>();
    private final Map<String, Employee> employees = new LinkedHashMap<>();
    private final List<PunchRecord> punches = new ArrayList<>();
    private final Map<String, String> sessions = new ConcurrentHashMap<>();

    @PostConstruct
    public synchronized void init() throws IOException {
        Path dir = Path.of(dataDir);
        Files.createDirectories(dir);

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

        Path empFile = dir.resolve("employees.json");
        if (Files.exists(empFile)) {
            List<Employee> loaded = mapper.readValue(empFile.toFile(), new TypeReference<>() {});
            for (Employee e : loaded) employees.put(e.employeeId, e);
        }

        Path punchFile = dir.resolve("punches.json");
        if (Files.exists(punchFile)) {
            punches.addAll(mapper.readValue(punchFile.toFile(), new TypeReference<>() {}));
        }
    }

    public synchronized Map<String, Object> login(String username, String password) {
        Account acc = accounts.stream()
                .filter(a -> a.username.equalsIgnoreCase(username) && Objects.equals(a.password, password))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials."));
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

    public synchronized List<Account> getAccounts() { return new ArrayList<>(accounts); }

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
        employees.put(emp.employeeId.trim(), emp);
        saveEmployees();
        return emp;
    }

    public synchronized void deleteEmployee(String id) throws IOException {
        employees.remove(id);
        saveEmployees();
    }

    public synchronized List<PunchRecord> getPunches() { return new ArrayList<>(punches); }

    public synchronized int clearPunches() throws IOException {
        int count = punches.size();
        punches.clear();
        savePunches();
        return count;
    }

    public synchronized Map<String, Object> importAttendanceFile(MultipartFile file) throws Exception {
        String filename = file.getOriginalFilename() == null ? "upload.dat" : file.getOriginalFilename();
        Set<String> seen = new HashSet<>();
        for (PunchRecord p : punches) seen.add(p.employeeId + "|" + p.punchTime + "|" + p.rawField5);

        int added = 0, dupes = 0;
        if (filename.toLowerCase().endsWith(".xlsx") || filename.toLowerCase().endsWith(".xls")) {
            DataFormatter df = new DataFormatter();
            try (Workbook wb = WorkbookFactory.create(file.getInputStream())) {
                for (Row row : wb.getSheetAt(0)) {
                    String eid = df.formatCellValue(row.getCell(0)).trim();
                    String tm = df.formatCellValue(row.getCell(1)).trim().replace("T", " ");
                    if (eid.isBlank() || !tm.matches("\\d{4}-\\d{2}-\\d{2}.*")) continue;
                    String r3 = df.formatCellValue(row.getCell(2)).trim();
                    String r4 = df.formatCellValue(row.getCell(3)).trim();
                    String r5 = df.formatCellValue(row.getCell(4)).trim();
                    String r6 = df.formatCellValue(row.getCell(5)).trim();
                    if (r5.isBlank()) r5 = "15";
                    String key = eid + "|" + tm + "|" + r5;
                    if (!seen.add(key)) { dupes++; continue; }
                    punches.add(new PunchRecord(eid, tm, r3.isBlank() ? "1" : r3, r4.isBlank() ? "255" : r4, r5, r6.isBlank() ? "0" : r6, filename));
                    employees.putIfAbsent(eid, new Employee(eid, "Employee " + eid, "CL-01", ""));
                    added++;
                }
            }
        } else {
            try (BufferedReader br = new BufferedReader(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    if (line.isBlank()) continue;
                    String[] c = line.trim().split("[\\t,;]+");
                    if (c.length < 2) continue;
                    String eid = c[0].trim().replace("\"", "");
                    String tm = c[1].trim().replace("\"", "").replace("T", " ");
                    if (eid.isBlank() || !tm.matches("\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}.*")) continue;
                    String r3 = c.length > 2 ? c[2].trim() : "1";
                    String r4 = c.length > 3 ? c[3].trim() : "255";
                    String r5 = c.length > 4 ? c[4].trim() : "15";
                    String r6 = c.length > 5 ? c[5].trim() : "0";
                    String key = eid + "|" + tm + "|" + r5;
                    if (!seen.add(key)) { dupes++; continue; }
                    punches.add(new PunchRecord(eid, tm, r3, r4, r5, r6, filename));
                    employees.putIfAbsent(eid, new Employee(eid, "Employee " + eid, "CL-01", ""));
                    added++;
                }
            }
        }
        savePunches();
        saveEmployees();
        return Map.of("filename", filename, "imported", added, "duplicates", dupes);
    }

    public synchronized Map<String, Object> importBinaryUserDat(MultipartFile file) throws IOException {
        byte[] bytes = file.getBytes();
        Matcher m = Pattern.compile("[ -~]{2,}").matcher(new String(bytes, StandardCharsets.ISO_8859_1));
        List<int[]> offsets = new ArrayList<>();
        List<String> vals = new ArrayList<>();
        while (m.find()) { offsets.add(new int[]{m.start()}); vals.add(m.group().trim()); }
        int added = 0, updated = 0;
        for (int i = 0; i < vals.size(); i++) {
            String id = vals.get(i);
            if (!(id.matches("(?i)[A-Z0-9][A-Z0-9_-]{0,39}") && id.matches(".*\\d.*"))) continue;
            String name = null;
            for (int j = i - 1; j >= 0; j--) {
                int dist = offsets.get(i)[0] - offsets.get(j)[0];
                if (dist > 45) break;
                String cand = vals.get(j);
                if (dist > 0 && cand.matches("(?i)[A-Z][A-Z .'_-]{1,60}") && !cand.matches(".*\\d.*")) { name = cand; break; }
            }
            if (name == null) continue;
            if (employees.containsKey(id)) { employees.get(id).name = name; updated++; }
            else { employees.put(id, new Employee(id, name, "CL-01", "")); added++; }
        }
        saveEmployees();
        return Map.of("imported", added, "updated", updated);
    }

    private void saveAccounts() throws IOException { mapper.writeValue(Path.of(dataDir, "accounts.json").toFile(), accounts); }
    private void saveEmployees() throws IOException { mapper.writeValue(Path.of(dataDir, "employees.json").toFile(), employees.values()); }
    private void savePunches() throws IOException { mapper.writeValue(Path.of(dataDir, "punches.json").toFile(), punches); }
}
